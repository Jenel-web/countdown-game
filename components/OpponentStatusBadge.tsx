'use client';

/**
 * components/OpponentStatusBadge.tsx
 *
 * Covers spec §6.1 — Opponent Status Badge driven by the `player_status`
 * server-to-client event.
 *
 * SPEC COMPLIANCE (§6.1 + §8 checklist):
 *   ✓ Small badge, top-right of opponent's score area
 *   ✓ 'thinking': grey static dot + "Thinking…" (no animation)
 *   ✓ 'submitted': animate-ping cyan dot + "Submitted" in text-primary-fixed-dim
 *   ✓ Same animate-ping pattern as lobby/page.tsx lines 251-254
 *   ✓ NEVER reveals resultValue, steps, or any scoring info — status label only
 *
 * USAGE:
 *   // In the match page, inside the opponent score header:
 *   const [opponentStatus, setOpponentStatus] =
 *     useState<'thinking' | 'submitted' | null>(null);
 *
 *   useSocketEvent('player_status', useCallback((payload) => {
 *     // player_status is broadcast to the OPPONENT only.
 *     // The server sends the emitting player's userId, but we only
 *     // care about status here — we don't need to filter by userId
 *     // because the server only sends this event to the other player.
 *     setOpponentStatus(payload.status);
 *   }, []));
 *
 *   // Reset to null at round_start (opponent begins a new round as 'thinking')
 *   useSocketEvent('round_start', useCallback(() => {
 *     setOpponentStatus('thinking');
 *   }, []));
 *
 *   <OpponentStatusBadge status={opponentStatus} />
 *
 * STATUS TRANSITIONS per round:
 *   null → (round_start) → 'thinking' → (player clicks tile) → 'thinking'
 *   → (player submits) → 'submitted'
 *
 *   The 'thinking' status is only emitted if the opponent explicitly calls
 *   emitThinking() (e.g. on first tile selection). The 'submitted' status
 *   is emitted automatically by the server inside submit_answer handling
 *   (roundHandlers.ts:271). Do NOT emit 'submitted' from the client manually.
 */

import { motion, AnimatePresence } from 'framer-motion';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface OpponentStatusBadgeProps {
  /**
   * Current status of the opponent. Pass null to render nothing (before
   * the first player_status event of a round).
   */
  status: 'thinking' | 'submitted' | null;
  /** Optional additional className for positioning (e.g. 'absolute top-2 right-2') */
  className?: string;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function OpponentStatusBadge({
  status,
  className = '',
}: OpponentStatusBadgeProps) {
  return (
    <AnimatePresence mode="wait">
      {status !== null && (
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: 0.8, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -4 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${className}`}
          style={{
            // Surface tint slightly different from the card so the badge
            // reads as an overlay element at small sizes
            backgroundColor: 'rgba(38, 43, 46, 0.85)', // surface-container-high with opacity
            backdropFilter: 'blur(4px)',
          }}
          aria-label={
            status === 'submitted'
              ? 'Opponent has submitted their answer'
              : 'Opponent is still thinking'
          }
          role="status"
        >
          {status === 'submitted' ? (
            // §6.1: "submitted: green pulsing dot + 'Submitted' in text-primary-fixed-dim"
            // animate-ping pattern mirrors lobby/page.tsx lines 251-254 exactly
            <>
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed-dim opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-fixed-dim" />
              </span>
              <span className="text-primary-fixed-dim">Submitted</span>
            </>
          ) : (
            // §6.1: "thinking: grey dot + 'Thinking…' (no animation)"
            <>
              <span
                className="inline-flex h-2 w-2 rounded-full bg-on-surface-variant/50"
                aria-hidden="true"
              />
              <span className="text-on-surface-variant">Thinking…</span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --------------------------------------------------------------------------
// Compound: OpponentScoreHeader
// --------------------------------------------------------------------------

/**
 * A ready-to-drop-in header row for the opponent's score panel that
 * combines a name label, cumulative score display, and the status badge.
 *
 * SPEC §6.1: badge in the "top-right corner of the opponent's score area"
 *
 * DISPLAY RULES (spec §5.1):
 *   - Show totalRaw / 100 formatted to 2 decimal places (e.g. "1.00 pts")
 *   - Never show raw integers to the user
 *
 * @example
 *   <OpponentScoreHeader
 *     label="Opponent"
 *     totalRaw={opponentTotalRaw}
 *     status={opponentStatus}
 *   />
 */
export interface OpponentScoreHeaderProps {
  /** Display name or "Opponent" fallback */
  label?: string;
  /** Cumulative pointsRaw from player1TotalRaw or player2TotalRaw */
  totalRaw: number;
  status: 'thinking' | 'submitted' | null;
}

export function OpponentScoreHeader({
  label = 'Opponent',
  totalRaw,
  status,
}: OpponentScoreHeaderProps) {
  // Format: "1.35 pts" — spec §5.1 display rule
  const scoreDisplay = `${(totalRaw / 100).toFixed(2)} pts`;

  return (
    <div className="flex items-center justify-between gap-3 w-full">
      {/* Left: label + score */}
      <div className="flex flex-col">
        <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">
          {label}
        </span>
        <span className="font-mono text-on-surface font-bold text-lg leading-tight">
          {scoreDisplay}
        </span>
      </div>

      {/* Right: status badge (top-right per spec §6.1) */}
      <OpponentStatusBadge status={status} />
    </div>
  );
}
