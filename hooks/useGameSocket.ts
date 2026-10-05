'use client';

/**
 * hooks/useGameSocket.ts
 *
 * The primary interface between React components and the Socket.io connection.
 *
 * EXPORTS:
 *   useGameSocket()   — main hook for emitting events and reading connection state
 *   useSocketEvent()  — helper for subscribing to a single server event with
 *                       automatic cleanup (the clean solution to the listener
 *                       accumulation problem)
 *
 * DESIGN PRINCIPLES:
 *
 * 1. NEVER inline arrow functions in socket.on() calls.
 *    Socket.io's socket.off(event, handler) only removes a listener if the
 *    handler reference matches exactly. An inline arrow creates a new reference
 *    on every render, making socket.off() a no-op and leaking listeners.
 *    This file enforces the named-handler pattern via useSocketEvent().
 *
 * 2. ALL emits are gated on isReconnecting.
 *    Emitting during a reconnect can target a dead connection. The emit()
 *    wrapper returned by useGameSocket silently drops calls while reconnecting
 *    and returns false so callers can show appropriate UI.
 *
 * 3. The hook does NOT create or own the socket.
 *    It reads it from GameSocketContext, which owns lifecycle (connect/disconnect).
 *    Components should never call socket.connect() or socket.disconnect() directly
 *    except via the Context or explicit cleanup handlers documented in
 *    UI_ERROR_STATES.md.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useGameSocketContext } from '@/context/GameSocketContext';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Step,
} from '@/lib/socket/types';

// --------------------------------------------------------------------------
// Public hook: useGameSocket
// --------------------------------------------------------------------------

export interface UseGameSocketReturn {
  /** True once the 'connect' event has fired. Always true inside the Provider tree. */
  isConnected: boolean;

  /**
   * True between a 'disconnect' and the next successful 'connect'.
   * Use this to show the ReconnectBanner and lock interactive elements.
   *
   * Implemented as a value derived from Context state — reading it here
   * is safe even in rapid reconnect cycles because the Context update
   * is synchronous relative to the socket event.
   */
  isReconnecting: boolean;

  /**
   * Typed emit wrapper. Returns true if the event was sent, false if it
   * was dropped because the socket is reconnecting.
   *
   * Usage:
   *   const sent = emit('join_room', { matchId });
   *   if (!sent) showNote('Connection lost — try again.', 'error');
   */
  emit: EmitFn;

  /**
   * Emits `submit_answer` with the correct resultValue calculation applied
   * automatically. Prefer this over calling emit('submit_answer', ...) directly
   * to ensure the resultValue rule (steps[last]?.result ?? 0) is always followed.
   *
   * Returns false if dropped due to reconnect.
   */
  submitAnswer: (steps: Step[]) => boolean;

  /**
   * Emits `player_status`. Do NOT call this with 'submitted' — the server
   * broadcasts that to the opponent automatically inside submit_answer handling.
   * Only use 'thinking' (e.g. when the player first selects a tile).
   */
  emitThinking: () => boolean;
}

// Typed emit function that mirrors ClientToServerEvents exactly.
// The overloads enforce payload types per event name at the call site.
type EmitFn = {
  <E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): boolean;
};

export function useGameSocket(): UseGameSocketReturn {
  const { socket, isConnected, isReconnecting } = useGameSocketContext();

  // A ref so that the closures inside emit/submitAnswer always read the
  // latest isReconnecting value without needing it in their dependency arrays.
  const isReconnectingRef = useRef(isReconnecting);
  useEffect(() => {
    isReconnectingRef.current = isReconnecting;
  }, [isReconnecting]);

  const emit: EmitFn = useCallback(
    <E extends keyof ClientToServerEvents>(
      event: E,
      ...args: Parameters<ClientToServerEvents[E]>
    ): boolean => {
      if (isReconnectingRef.current) {
        // Drop the emit silently. The caller checks the return value to decide
        // whether to surface an error toast to the user.
        console.warn(`[useGameSocket] emit('${event}') dropped — socket is reconnecting`);
        return false;
      }
      // The cast is necessary because TypeScript cannot statically verify that
      // spreading `args` into socket.emit satisfies the overloaded signature.
      // The runtime behaviour is correct: event + args match ClientToServerEvents.
      (socket.emit as (...a: unknown[]) => void)(event, ...args);
      return true;
    },
    [socket]
  );

  const submitAnswer = useCallback(
    (steps: Step[]): boolean => {
      // Rule from events.ts: always compute resultValue as the last step's
      // result. The server ignores this value but a mismatch is a debug hazard.
      const resultValue = steps[steps.length - 1]?.result ?? 0;
      return emit('submit_answer', { steps, resultValue });
    },
    [emit]
  );

  const emitThinking = useCallback((): boolean => {
    return emit('player_status', { status: 'thinking' });
  }, [emit]);

  return { isConnected, isReconnecting, emit, submitAnswer, emitThinking };
}

// --------------------------------------------------------------------------
// Helper hook: useSocketEvent
// --------------------------------------------------------------------------

/**
 * Subscribes to a single server-to-client socket event and cleans up
 * automatically when the component unmounts or the handler changes.
 *
 * CRITICAL: pass a stable handler reference (from useCallback or a ref).
 * If you pass a new function on every render, the subscription will be
 * removed and re-added on every render — functionally correct but wasteful.
 *
 * @example
 *   const handleRoundStart = useCallback((payload) => {
 *     setTiles(payload.tiles);
 *     setTarget(payload.target);
 *   }, []);
 *
 *   useSocketEvent('round_start', handleRoundStart);
 *
 * WHY NOT useEffect + socket.on inside the component directly?
 * Because developers (and AI agents) consistently forget the socket.off()
 * cleanup, or use an inline arrow function making it unreachable. This hook
 * makes the cleanup structural — it is impossible to use without it.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E]
): void {
  const { socket } = useGameSocketContext();

  // Store the handler in a ref to avoid the effect re-running when the
  // consumer passes a new (but semantically identical) function reference.
  // This is a "latest ref" pattern — the socket always calls the most
  // recent version of the handler without needing to re-register.
  const handlerRef = useRef<ServerToClientEvents[E]>(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // The stable wrapper delegates to the latest handler via the ref.
    // This single wrapper reference is what socket.on() and socket.off()
    // both receive, guaranteeing the cleanup actually removes this listener.
    const stableWrapper = (...args: Parameters<ServerToClientEvents[E]>) => {
      // @ts-expect-error — spreading args into a union-typed function.
      // Safe at runtime: args are always the correct type for this event.
      (handlerRef.current as (...a: typeof args) => void)(...args);
    };

    socket.on(event, stableWrapper as ServerToClientEvents[E]);

    return () => {
      socket.off(event, stableWrapper as ServerToClientEvents[E]);
    };
  }, [socket, event]); // handler intentionally excluded — handled via ref
}

// --------------------------------------------------------------------------
// Derived helpers: join_room lifecycle
// --------------------------------------------------------------------------

/**
 * Emits join_room on mount and re-emits it after every successful reconnect.
 *
 * This covers the reconnect re-registration path: the server's isExistingPlayer2
 * branch in roomHandlers.ts handles a second join_room gracefully by just
 * updating the socket ID without restarting the round.
 *
 * @param matchId  From useParams().matchId — must be stable across renders.
 * @param enabled  Pass false to suppress the emit (e.g. while auth is loading).
 */
export function useJoinRoom(matchId: string, enabled = true): void {
  const { socket, isConnected, isReconnecting } = useGameSocketContext();

  // Track whether we have successfully joined at least once this session.
  const hasJoinedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isConnected || !matchId) return;

    // On the very first connect, or after a reconnect (isReconnecting just
    // became false while isConnected is now true), emit join_room.
    socket.emit('join_room', { matchId });
    hasJoinedRef.current = true;

    // No cleanup needed — join_room is fire-and-forget. The server deduplicates
    // repeated joins from the same user on the same match.
  }, [socket, isConnected, isReconnecting, matchId, enabled]);
}
