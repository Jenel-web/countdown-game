'use client';

/**
 * components/ReconnectBanner.tsx
 *
 * Covers spec §4.1 (Connection Lost), §4.2 (Reconnect Attempt), and
 * §4.3 (Reconnect Failed — upgrades to a full-screen modal).
 *
 * CRITICAL DESIGN RULES (spec §4.4 + §8):
 *
 * 1. POINTER-EVENTS-NONE on the controls overlay — spec §4.1:
 *    "Apply pointer-events-none + opacity-40. This is critical."
 *    Opacity alone still allows clicks in most browsers. This component
 *    renders a transparent lockout overlay that sits over the game controls
 *    panel with pointer-events-none applied at the overlay level so ALL
 *    child buttons become unclickable — without needing each button to
 *    individually check isReconnecting.
 *
 * 2. isReconnecting as a REF in the parent — spec §4.4:
 *    This component accepts isReconnecting as a plain boolean prop (derived
 *    from the GameSocketContext state value). The useRef gate that prevents
 *    double-submission lives in useGameSocket.ts, not here. This component's
 *    job is purely visual lockout.
 *
 * 3. Attempt counter — tracked internally via socket event subscription
 *    that the parent passes in as attemptNumber.
 *
 * 4. Full-screen modal on reconnect_failed — the banner "upgrades" to a
 *    modal by rendering an AnimatePresence-driven overlay when failed=true.
 *    socket.disconnect() + destroySocket() is called before routing
 *    (spec §8 checklist).
 *
 * USAGE:
 *   <ReconnectBanner
 *     isReconnecting={isReconnecting}   // from useGameSocket()
 *     attemptNumber={reconnectAttempt}  // from useSocketEvent('reconnect_attempt')
 *     failed={reconnectFailed}          // from useSocketEvent('reconnect_failed')
 *   />
 *   // Place OUTSIDE the controls panel, at the match page root level.
 *   // The lockout overlay for the controls panel is a SEPARATE element
 *   // rendered by this component via a portal-like fixed div.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { destroySocket } from '@/lib/socket/socketClient';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ReconnectBannerProps {
  /** True between 'disconnect' and the next 'connect'. */
  isReconnecting: boolean;
  /**
   * Current reconnect attempt number (1-based).
   * Pass 0 or undefined to show "Connection lost. Reconnecting…" without a counter.
   */
  attemptNumber?: number;
  /**
   * True after 'reconnect_failed' fires (all attempts exhausted).
   * Upgrades the banner to the full-screen modal (spec §4.3).
   */
  failed?: boolean;
}

// --------------------------------------------------------------------------
// Animation variants
// --------------------------------------------------------------------------

const bannerVariants = {
  hidden: { y: '-100%', opacity: 0 },
  visible: {
    y: '0%', opacity: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 35 },
  },
  exit: {
    y: '-100%', opacity: 0,
    transition: { duration: 0.2 },
  },
};

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const cardVariants = {
  hidden: { scale: 0.88, opacity: 0, y: 16 },
  visible: {
    scale: 1, opacity: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 26 },
  },
  exit: { scale: 0.88, opacity: 0, y: 16, transition: { duration: 0.15 } },
};

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function ReconnectBanner({
  isReconnecting,
  attemptNumber,
  failed = false,
}: ReconnectBannerProps) {
  const router = useRouter();

  const handleReturnToLobby = useCallback(() => {
    // RULE: socket.disconnect() MUST precede router.push() (spec §8)
    // destroySocket() also clears the singleton so the next match starts fresh.
    destroySocket();
    router.push('/lobby');
  }, [router]);

  const bannerText =
    failed
      ? 'Connection failed.'
      : attemptNumber && attemptNumber > 0
      ? `Reconnecting… (attempt ${attemptNumber})`
      : 'Connection lost. Reconnecting…';

  const shouldShowBanner = (isReconnecting || failed) && !failed; // banner only when reconnecting, not after failed
  const shouldShowLockout = isReconnecting || failed; // lockout persists through both states

  return (
    <>
      {/* ── §4.1 / §4.2 Sticky warning banner ──────────────────────────── */}
      <AnimatePresence>
        {shouldShowBanner && (
          <motion.div
            key="reconnect-banner"
            variants={bannerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="alert"
            aria-live="polite"
            className="fixed top-0 left-0 right-0 z-40 bg-error-container/95 backdrop-blur-sm"
          >
            <div className="flex items-center justify-center gap-2.5 py-3 px-4">
              <span
                className="material-symbols-outlined text-on-error-container text-[18px] animate-spin"
                aria-hidden="true"
              >
                progress_activity
              </span>
              <span className="text-on-error-container font-bold text-sm tracking-wide">
                {bannerText}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls lockout overlay ─────────────────────────────────────
          SPEC §4.1: "Apply pointer-events-none + opacity-40. This is critical."
          This transparent fixed layer sits over the entire game board when
          reconnecting, making every interactive element unclickable without
          needing to modify each button individually.

          z-30 keeps it below the banner (z-40) and below modals (z-50)
          but above the game board content.

          The opacity-40 dimming is applied here rather than on the game
          board itself so that the board remains fully visible behind the
          ReconnectBanner — the user can see their work but not interact.
      ──────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {shouldShowLockout && (
          <motion.div
            key="controls-lockout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-30 bg-background/40 pointer-events-auto"
            // pointer-events-auto on the overlay itself so clicks are absorbed
            // before they can reach any game control underneath.
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* ── §4.3 Reconnect Failed full-screen modal ──────────────────────── */}
      <AnimatePresence>
        {failed && (
          <motion.div
            key="reconnect-failed-modal"
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
              {/* Icon — spec §4.3: signal_disconnected, text-error */}
              <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-5xl text-error"
                  aria-hidden="true"
                >
                  signal_disconnected
                </span>
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2">
                <h2 className="font-bold text-2xl text-on-background">
                  Connection Failed
                </h2>
                <p className="text-on-surface-variant text-body-sm leading-relaxed">
                  We couldn&apos;t reconnect to the game server. Your progress has been saved.
                </p>
              </div>

              {/* CTA — spec §4.3: "Return to Lobby" */}
              <button
                onClick={handleReturnToLobby}
                className="
                  w-full py-3 rounded-xl
                  bg-error-container text-on-error-container
                  font-bold text-sm uppercase tracking-wider
                  hover:opacity-90 active:scale-95
                  transition-all duration-150
                "
              >
                Return to Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
