'use client';

/**
 * components/ErrorModal.tsx
 *
 * Parametric full-screen error modal covering all Room Entry Rejections
 * (spec §1.1 – §1.4) and the Reconnect Failed state (spec §4.3).
 *
 * SPEC COMPLIANCE:
 *   - Fixed overlay: fixed inset-0 z-50 bg-black/70 backdrop-blur-sm
 *   - glass-panel card, max-w-sm centred
 *   - Material Symbols Outlined icon (not lucide — matches existing app pattern)
 *   - socket.disconnect() is called BEFORE router.push() on every CTA
 *   - AnimatePresence drives entry/exit (mirrors app/game/page.tsx §312-335)
 *   - No close/dismiss — user MUST use the CTA (spec §1.1)
 *
 * USAGE:
 *   // In app/match/[matchId]/page.tsx:
 *   const [errorModal, setErrorModal] = useState<ErrorModalConfig | null>(null);
 *
 *   useSocketEvent('error', useCallback((payload) => {
 *     setErrorModal(ERROR_CONFIGS[payload.code] ?? ERROR_CONFIGS.generic);
 *   }, []));
 *
 *   <ErrorModal config={errorModal} onClose={() => setErrorModal(null)} />
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { destroySocket } from '@/lib/socket/socketClient';
import type { ServerErrorCode } from '@/lib/socket/types';

// --------------------------------------------------------------------------
// Config type
// --------------------------------------------------------------------------

export interface ErrorModalConfig {
  /** Material Symbols Outlined icon name, e.g. 'lock', 'search_off' */
  icon: string;
  /** Tailwind text-colour class for the icon, e.g. 'text-error' */
  iconColour: string;
  headline: string;
  body: string;
  ctaLabel: string;
  /** '/lobby' | '/login' */
  ctaRoute: string;
}

// --------------------------------------------------------------------------
// Preset configs — one per spec section
// --------------------------------------------------------------------------

/**
 * Map from server error.code to modal config.
 * Import this alongside ErrorModal and index into it with the code string.
 */
export const ERROR_CONFIGS: Record<ServerErrorCode | 'generic' | 'auth' | 'reconnect_failed', ErrorModalConfig> = {
  // §1.1 Room Full
  room_full: {
    icon: 'lock',
    iconColour: 'text-error',
    headline: 'Match Full',
    body: 'This challenge link has already been claimed by another player.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
  // §1.2 Match Already Ended
  match_finished: {
    icon: 'emoji_events',
    iconColour: 'text-primary-fixed-dim',
    headline: 'Match Already Ended',
    body: 'This match has concluded. Check your stats in the lobby.',
    ctaLabel: 'View My Stats',
    ctaRoute: '/lobby',
  },
  // §1.3 Invalid Room
  not_found: {
    icon: 'search_off',
    iconColour: 'text-on-surface-variant',
    headline: 'Room Not Found',
    body: 'This challenge link is invalid or has expired.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
  // §1.4 Auth Failure (connect_error with 'Unauthorized')
  auth: {
    icon: 'no_accounts',
    iconColour: 'text-error',
    headline: 'Session Expired',
    body: 'Your session has expired. Please log in again.',
    ctaLabel: 'Log In',
    ctaRoute: '/login',
  },
  // §4.3 Reconnect Failed
  reconnect_failed: {
    icon: 'signal_disconnected',
    iconColour: 'text-error',
    headline: 'Connection Failed',
    body: "We couldn't reconnect to the game server. Your progress has been saved.",
    ctaLabel: 'Return to Lobby',
    ctaRoute: '/lobby',
  },
  // Submission errors — shown as toasts, not modals, but included for exhaustiveness
  not_in_room: {
    icon: 'warning',
    iconColour: 'text-error',
    headline: 'Not In Room',
    body: 'Submit failed: not in a match room.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
  no_active_round: {
    icon: 'timer_off',
    iconColour: 'text-on-surface-variant',
    headline: 'Round Ended',
    body: 'Submit failed: no active round.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
  not_a_player: {
    icon: 'person_off',
    iconColour: 'text-error',
    headline: 'Not a Player',
    body: 'Submit failed: not recognised as a player in this match.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
  // Fallback for unknown codes
  generic: {
    icon: 'error_outline',
    iconColour: 'text-error',
    headline: 'Something Went Wrong',
    body: 'An unexpected error occurred. Please return to the lobby.',
    ctaLabel: 'Back to Lobby',
    ctaRoute: '/lobby',
  },
};

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export interface ErrorModalProps {
  /** Pass null to hide the modal. */
  config: ErrorModalConfig | null;
  /** Called after the socket is disconnected and router.push() is invoked. */
  onClose?: () => void;
}

export default function ErrorModal({ config, onClose }: ErrorModalProps) {
  const router = useRouter();

  const handleCta = useCallback(() => {
    // RULE: socket.disconnect() MUST be called before router.push().
    // destroySocket() disconnects and clears the module-level singleton so
    // a fresh connection is created if the user re-enters a match later.
    destroySocket();
    onClose?.();
    router.push(config?.ctaRoute ?? '/lobby');
  }, [config?.ctaRoute, onClose, router]);

  return (
    <AnimatePresence>
      {config && (
        // Overlay
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          // No onClick on backdrop — spec §1.1: "No close/dismiss action"
        >
          {/* Card */}
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.88, opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="glass-panel rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col items-center gap-5 text-center"
          >
            {/* Icon */}
            <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center">
              <span
                className={`material-symbols-outlined text-4xl ${config.iconColour}`}
                aria-hidden="true"
              >
                {config.icon}
              </span>
            </div>

            {/* Text */}
            <div className="flex flex-col gap-2">
              <h2 className="font-bold text-2xl text-on-background leading-tight">
                {config.headline}
              </h2>
              <p className="text-on-surface-variant text-body-sm leading-relaxed">
                {config.body}
              </p>
            </div>

            {/* CTA */}
            <button
              onClick={handleCta}
              className="
                w-full py-3 rounded-xl font-bold text-sm uppercase tracking-wider
                bg-error-container text-on-error-container
                hover:opacity-90 active:scale-95
                transition-all duration-150
              "
            >
              {config.ctaLabel}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
