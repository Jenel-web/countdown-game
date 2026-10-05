'use client';

/**
 * hooks/useRoundTimer.ts
 *
 * A server-synchronised round countdown timer.
 *
 * WHY NOT a local setInterval counting from 30:
 *   A local countdown drifts from the server's truth. If player A receives
 *   round_start 80 ms after player B (due to differing network latency),
 *   their timers would diverge by 80 ms immediately and accumulate further
 *   drift each second. More critically, the server's evaluateRound() fires
 *   after exactly ROUND_DURATION_MS from its own Date.now() — not from when
 *   the client received the event. A local countdown would show "0" at the
 *   wrong moment, causing visual desync.
 *
 * THE CORRECT APPROACH:
 *   Derive remaining time by comparing the server's `startTimestamp` against
 *   the client's current Date.now(). This way:
 *   - Both clients display the same remaining time (modulo screen render lag)
 *   - The timer naturally converges to 0 at the same moment the server fires
 *   - Latency is absorbed once at round_start, never accumulated
 *
 * TICK INTERVAL — 250 ms:
 *   Ticking every 1 000 ms is the obvious choice but produces a choppy timer
 *   bar. 250 ms gives 4× smoother animation with negligible CPU cost. The
 *   displayed integer seconds are still floored, so the number only changes
 *   once per second — the smoothness benefit is in the progress bar's width.
 *
 * FREEZE:
 *   Call freeze() to halt the timer visually (opponent disconnect, reconnect
 *   banner). The internal interval keeps running against real time so that if
 *   freeze() is followed by unfreeze(), the display catches up correctly.
 *   This avoids the bug where a player disconnects for 10 s, reconnects, and
 *   their timer still shows the pre-disconnect value.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface RoundTimerState {
  /** Integer seconds remaining (0–30). Always 0 when the round has expired. */
  secondsLeft: number;

  /**
   * Progress percentage for the timer bar: 100 = full, 0 = empty.
   * Computed as (remaining / total) * 100, clamped to [0, 100].
   * Updates every 250 ms for smooth animation.
   */
  pct: number;

  /** True when the timer has been explicitly frozen (e.g. opponent disconnect). */
  isFrozen: boolean;

  /** True when secondsLeft has reached 0. */
  isExpired: boolean;
}

export interface RoundTimerControls {
  /**
   * Start (or restart) the timer for a new round.
   *
   * @param startTimestamp  The server's Date.now() at round start.
   *                        From round_start.startTimestamp.
   * @param durationMs      Round duration in ms. From round_start.durationMs.
   *                        Always 30_000 in the current server implementation.
   */
  start: (startTimestamp: number, durationMs: number) => void;

  /**
   * Freeze the visual display. The internal calculation keeps running against
   * real time, so unfreeze() will immediately show the correct current value.
   * Call this when:
   *   - opponent_left fires (UI_ERROR_STATES.md §3.1)
   *   - socket 'disconnect' fires (UI_ERROR_STATES.md §4.1)
   */
  freeze: () => void;

  /** Unfreeze and resume live display. Call this when the reconnect succeeds. */
  unfreeze: () => void;

  /** Reset to the idle state (secondsLeft=0, pct=100, isFrozen=false). */
  reset: () => void;
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function computeState(
  startTimestamp: number | null,
  durationMs: number
): Pick<RoundTimerState, 'secondsLeft' | 'pct' | 'isExpired'> {
  if (startTimestamp === null) {
    return { secondsLeft: 0, pct: 100, isExpired: false };
  }

  const elapsedMs = Date.now() - startTimestamp;
  const remainingMs = Math.max(0, durationMs - elapsedMs);
  const secondsLeft = Math.floor(remainingMs / 1000);
  const pct = Math.min(100, Math.max(0, (remainingMs / durationMs) * 100));
  const isExpired = remainingMs === 0;

  return { secondsLeft, pct, isExpired };
}

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

/**
 * @returns [state, controls]
 *
 * @example
 *   const [timer, timerControls] = useRoundTimer();
 *
 *   // In round_start handler:
 *   timerControls.start(payload.startTimestamp, payload.durationMs);
 *
 *   // In opponent_left / disconnect handler:
 *   timerControls.freeze();
 *
 *   // TimerBar component:
 *   <div style={{ width: `${timer.pct}%` }} />
 *   <span>{timer.secondsLeft}s</span>
 */
export function useRoundTimer(): [RoundTimerState, RoundTimerControls] {
  // ── Refs (mutable, no re-render on change) ────────────────────────────────

  // Server-provided round parameters. Stored in refs so the interval
  // closure always reads the latest values without needing to be recreated.
  const startTimestampRef = useRef<number | null>(null);
  const durationMsRef = useRef<number>(30_000);

  // Freeze flag. A ref (not state) so freeze() is synchronous and does not
  // cause a re-render flicker on the same frame as an opponent_left event.
  const isFrozenRef = useRef(false);

  // The setInterval handle, stored in a ref so start() can clear a previous
  // interval before creating a new one without a useEffect dependency.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── State (triggers re-render, drives the UI) ─────────────────────────────

  const [timerState, setTimerState] = useState<RoundTimerState>({
    secondsLeft: 0,
    pct: 100,
    isFrozen: false,
    isExpired: false,
  });

  // ── Tick function ─────────────────────────────────────────────────────────

  // Defined as a stable function (no dependencies that change) so the
  // interval callback reference never needs to be replaced mid-round.
  const tick = useCallback(() => {
    if (isFrozenRef.current) return; // Display is halted — skip this tick.

    const { secondsLeft, pct, isExpired } = computeState(
      startTimestampRef.current,
      durationMsRef.current
    );

    setTimerState((prev) => {
      // Bail out if nothing meaningful changed (same integer second, same
      // frozen state). This prevents unnecessary React re-renders on every
      // 250 ms tick when the second hasn't turned over yet.
      // Exception: always update if pct changed, because the bar needs it.
      if (
        prev.secondsLeft === secondsLeft &&
        Math.abs(prev.pct - pct) < 0.5 &&
        prev.isExpired === isExpired
      ) {
        return prev;
      }
      return { secondsLeft, pct, isFrozen: false, isExpired };
    });

    // Clear the interval once the timer has expired to avoid unnecessary
    // ticking after the round is over. The server timeout will fire shortly
    // after and emit round_result — we don't need to keep polling.
    if (isExpired && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []); // stable — reads from refs only

  // ── Controls ──────────────────────────────────────────────────────────────

  const start = useCallback(
    (startTimestamp: number, durationMs: number) => {
      // Update refs synchronously before the next tick.
      startTimestampRef.current = startTimestamp;
      durationMsRef.current = durationMs;
      isFrozenRef.current = false;

      // Clear any running interval from the previous round.
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }

      // Run an immediate tick so the UI updates on the same frame as the
      // round_start event, without waiting 250 ms for the first interval tick.
      const initial = computeState(startTimestamp, durationMs);
      setTimerState({ ...initial, isFrozen: false });

      // Start the 250 ms tick loop.
      intervalRef.current = setInterval(tick, 250);
    },
    [tick]
  );

  const freeze = useCallback(() => {
    isFrozenRef.current = true;
    // Immediately reflect the frozen state in the UI — do not wait for
    // the next tick to update isFrozen.
    setTimerState((prev) => ({ ...prev, isFrozen: true }));
  }, []);

  const unfreeze = useCallback(() => {
    isFrozenRef.current = false;
    // Resume ticking by running an immediate tick. The interval is still
    // running (freeze doesn't stop it), so the next tick will fire naturally.
    tick();
    setTimerState((prev) => ({ ...prev, isFrozen: false }));
  }, [tick]);

  const reset = useCallback(() => {
    startTimestampRef.current = null;
    isFrozenRef.current = false;

    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setTimerState({ secondsLeft: 0, pct: 100, isFrozen: false, isExpired: false });
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────

  const controls: RoundTimerControls = { start, freeze, unfreeze, reset };
  return [timerState, controls];
}

// --------------------------------------------------------------------------
// Formatted display helper
// --------------------------------------------------------------------------

/**
 * Formats secondsLeft as MM:SS for the timer display.
 *
 * @example
 *   formatTimerDisplay(95) // '01:35'
 *   formatTimerDisplay(7)  // '00:07'
 */
export function formatTimerDisplay(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
