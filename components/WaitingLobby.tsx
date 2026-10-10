'use client';

/**
 * components/WaitingLobby.tsx
 *
 * Covers spec §2.1 (Waiting for Opponent), §2.2 (Opponent Joining flash),
 * and §3.1 (Opponent Disconnected / opponent_left forfeit modal).
 *
 * ARCHITECTURE NOTES:
 *
 * This component renders ONE of three mutually exclusive views, driven by
 * the `phase` prop from the match page's state machine:
 *
 *   'waiting'          → §2.1 invite-link waiting card
 *   'opponent_joined'  → §2.2 success flash (auto-dismisses via parent timeout)
 *   'opponent_left'    → §3.1 forfeit win modal
 *
 * WHY opponent_left IS HANDLED HERE, NOT IN ErrorModal:
 *   §3.1 spec: "opponent_left has no payload and does NOT precede match_over."
 *   It has bespoke content (forfeit win vs error), a different icon colour,
 *   and a different CTA label ("Claim Victory & Continue"). Placing it here
 *   keeps it isolated from the error path and prevents any future developer
 *   from accidentally wiring match_over to the same handler.
 *
 * SPEC COMPLIANCE CHECKLIST (§8):
 *   ✓ socket.disconnect() called before router.push() in all CTAs
 *   ✓ opponent_left does NOT wait for match_over (self-sufficient)
 *   ✓ AnimatePresence drives all entry/exit animations
 *   ✓ animate-ping dot matches lobby/page.tsx lines 251-254 exactly
 *   ✓ Copy-link: 2 000 ms revert, reads window.location.href
 *   ✓ Cancel button always enabled (not disabled during waiting)
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { destroySocket } from '@/lib/socket/socketClient';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type WaitingPhase = 'waiting' | 'opponent_joined' | 'opponent_left';

export interface WaitingLobbyProps {
  phase: WaitingPhase;
  /** The current match URL — passed from the page so this component is
   *  testable without needing a real window.location. Defaults to
   *  window.location.href if omitted (safe in the browser). */
  matchUrl?: string;
  /** Optional callback fired when the user cancels waiting to leave the lobby cleanly. */
  onCancel?: () => void;
}

// --------------------------------------------------------------------------
// Overlay animation variants (reused across sub-views)
// --------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const cardVariants = {
  hidden: { scale: 0.88, opacity: 0, y: 20 },
  visible: {
    scale: 1, opacity: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 26 },
  },
  exit: { scale: 0.88, opacity: 0, y: 20, transition: { duration: 0.15 } },
};

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function WaitingLobby({ phase, matchUrl, onCancel }: WaitingLobbyProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  // Resolve the invite URL — spec §2.1: "showing the match URL (window.location.href)"
  const inviteUrl =
    matchUrl ??
    (typeof window !== 'undefined' ? window.location.href : '');

  const copyLink = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // Clipboard API unavailable — silently ignore, UX degrades gracefully
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteUrl]);

  // RULE: socket.disconnect() MUST precede router.push() (spec §2.1 cancel, §3.1 CTA)
  const handleLeave = useCallback(() => {
    if (onCancel) {
      onCancel();
    } else {
      destroySocket();
      router.push('/lobby');
    }
  }, [onCancel, router]);

  // Forfeit-win CTA: the server already finished the match, so there is
  // nothing to cancel. Always get the player to the lobby, even if socket
  // teardown throws.
  const handleClaimVictory = useCallback(() => {
    try {
      destroySocket();
    } catch (err) {
      console.error('[WaitingLobby] destroySocket failed on forfeit exit', err);
    }
    try {
      router.push('/lobby');
    } catch (err) {
      console.error('[WaitingLobby] router.push failed, hard redirecting', err);
      window.location.assign('/lobby');
    }
  }, [router]);
  return (
    <>
      {/* ── §2.1 Waiting for Opponent ──────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'waiting' && (
          <motion.div
            key="waiting"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="glass-panel rounded-2xl p-8 max-w-md w-full mx-4 flex flex-col items-center gap-6 text-center"
            >
              {/* Pulse dot + headline — mirrors lobby/page.tsx lines 251-254 */}
              <div className="flex flex-col items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed-dim opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-primary-fixed-dim" />
                </span>
                <h2 className="font-bold text-2xl text-on-background">
                  Waiting for Opponent…
                </h2>
                <p className="text-on-surface-variant text-body-sm">
                  Share the link below to invite a friend.
                </p>
              </div>

              {/* Invite link — mirrors lobby/page.tsx lines 237-248 */}
              <div className="w-full flex items-center">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  aria-label="Match invite link"
                  className="
                    bg-background border border-outline-variant/30
                    rounded-l-xl py-2.5 px-3 flex-1 truncate
                    font-mono text-sm text-on-surface-variant
                    outline-none select-all
                  "
                />
                <button
                  onClick={copyLink}
                  className="
                    bg-surface-container-high border border-outline-variant/30
                    border-l-0 text-primary-fixed-dim
                    px-4 py-2.5 rounded-r-xl
                    font-label-caps text-label-caps
                    hover:bg-surface-container-highest
                    transition-colors h-full min-w-[96px]
                    flex items-center justify-center gap-1.5
                  "
                >
                  {copied ? (
                    <>
                      <span className="material-symbols-outlined text-[15px]">check</span>
                      Copied!
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[15px]">content_copy</span>
                      Copy Link
                    </>
                  )}
                </button>
              </div>

              {/* Cancel — always enabled, spec §2.1 */}
              <button
                onClick={handleLeave}
                className="
                  w-full py-2.5 rounded-xl
                  text-on-surface-variant text-sm font-bold uppercase tracking-wider
                  border border-outline-variant/40
                  hover:text-error hover:border-error
                  transition-colors duration-150
                "
              >
                Cancel &amp; Leave
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── §2.2 Opponent Joined flash ─────────────────────────────────── */}
      {/* Note: this is rendered as a toast by the match page directly      */}
      {/* using showNote('Game opponent joined! Get ready…', 'success').    */}
      {/* WaitingLobby does not render the toast — the page transitions     */}
      {/* phase away from 'opponent_joined' after 800 ms automatically.    */}

      {/* ── §3.1 Opponent Left / Forfeit Win ──────────────────────────── */}
      <AnimatePresence>
        {phase === 'opponent_left' && (
          <motion.div
            key="opponent_left"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="glass-panel rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col items-center gap-6 text-center"
            >
              {/* Icon — spec §3.1: wifi_off, text-primary-fixed-dim, animate-pulse */}
              <div className="w-20 h-20 rounded-full bg-surface-container-high flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-5xl text-primary-fixed-dim animate-pulse"
                  aria-hidden="true"
                >
                  wifi_off
                </span>
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2">
                <h2 className="font-bold text-2xl text-on-background">
                  Opponent Disconnected
                </h2>
                <p className="text-on-surface-variant text-body-sm leading-relaxed">
                  Your opponent left the game.{' '}
                  <span className="text-primary-fixed-dim font-semibold">
                    You win by forfeit!
                  </span>
                </p>
              </div>

              {/* CTA — spec §3.1: "Claim Victory & Continue" */}
              {/* NOTE: server has already called finish_match() — no Supabase call needed */}
              <button
                onClick={handleClaimVictory}
                className="
                  w-full py-3 rounded-xl
                  bg-primary-container text-on-primary-container
                  font-bold text-sm uppercase tracking-wider
                  neon-glow hover:opacity-90 active:scale-95
                  transition-all duration-150
                  flex items-center justify-center gap-2
                "
              >
                <span className="material-symbols-outlined text-[18px]">
                  emoji_events
                </span>
                Claim Victory &amp; Continue
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
