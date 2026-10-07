'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Swords, RotateCcw, XCircle, CheckCircle2, Clock, Home, Loader2 } from 'lucide-react';

export type RematchState =
  /** Local player sent the offer and is waiting for opponent's answer. */
  | 'waiting_for_response'
  /** Opponent sent the offer; local player can accept or decline. */
  | 'incoming_offer'
  /** Opponent declined the rematch offer. */
  | 'declined'
  /** Rematch was accepted; navigating to new match. */
  | 'accepted'
  | null;

export interface RematchModalProps {
  state: RematchState;
  opponentName?: string;
  onAccept: () => void;
  onDecline: () => void;
  onCancelRequest?: () => void;
  onReturnToLobby: () => void;
}

const OFFER_TIMEOUT_SECS = 30;

export default function RematchModal({
  state,
  opponentName = 'Opponent',
  onAccept,
  onDecline,
  onCancelRequest,
  onReturnToLobby,
}: RematchModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(OFFER_TIMEOUT_SECS);

  // Auto-decline incoming offer after 30 s if ignored
  useEffect(() => {
    if (state !== 'incoming_offer') return;
    setSecondsLeft(OFFER_TIMEOUT_SECS);

    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          onDecline();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state, onDecline]);

  if (!state) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 24, stiffness: 300 }}
          className="relative w-full max-w-md bg-surface-container-low border border-primary-container/40 rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col items-center text-center gap-5"
        >
          {/* Ambient Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-primary-container/15 blur-3xl pointer-events-none" />

          {/* 1. WAITING FOR OPPONENT RESPONSE */}
          {state === 'waiting_for_response' && (
            <>
              <div className="w-16 h-16 rounded-full bg-primary-container/20 border border-primary-fixed-dim/40 flex items-center justify-center text-primary-fixed-dim shadow-[0_0_20px_rgba(0,240,255,0.3)]">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-black text-on-surface uppercase tracking-wide">
                  Rematch Requested
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                  Waiting for <span className="text-primary-fixed-dim font-bold">{opponentName}</span> to accept the rematch offer...
                </p>
              </div>

              <div className="w-full flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCancelRequest ?? onReturnToLobby}
                  className="w-full py-2.5 rounded-xl border border-outline-variant hover:border-error hover:text-error text-on-surface-variant transition-colors text-xs font-bold uppercase tracking-wider"
                >
                  Cancel &amp; Return to Lobby
                </button>
              </div>
            </>
          )}

          {/* 2. INCOMING OFFER */}
          {state === 'incoming_offer' && (
            <>
              <div className="w-16 h-16 rounded-full bg-secondary-container/30 border border-secondary/50 flex items-center justify-center text-secondary shadow-[0_0_25px_rgba(182,196,255,0.4)]">
                <Swords className="w-8 h-8" />
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-black text-on-surface uppercase tracking-wide">
                  Rematch Challenge!
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                  <span className="text-primary-fixed-dim font-bold">{opponentName}</span> has invited you to a rematch.
                </p>
              </div>

              {/* Expiry countdown bar */}
              <div className="w-full flex flex-col gap-1.5 bg-surface-container/60 p-2.5 rounded-xl border border-outline-variant/20">
                <div className="flex justify-between items-center text-[11px] text-on-surface-variant font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-primary-fixed-dim" /> Auto-declines in
                  </span>
                  <span className="font-bold text-on-surface">{secondsLeft}s</span>
                </div>
                <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(secondsLeft / OFFER_TIMEOUT_SECS) * 100}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={onDecline}
                  className="w-full py-3 rounded-xl border border-outline-variant/60 hover:border-error/60 hover:bg-error-container/20 text-on-surface-variant hover:text-error transition-all font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  Decline
                </button>

                <button
                  type="button"
                  onClick={onAccept}
                  className="w-full py-3 rounded-xl bg-primary-container text-on-primary-container hover:bg-primary transition-all font-bold text-xs uppercase tracking-wider neon-glow shadow-[0_0_15px_rgba(0,229,255,0.4)] active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Accept
                </button>
              </div>
            </>
          )}

          {/* 3. OFFER DECLINED */}
          {state === 'declined' && (
            <>
              <div className="w-16 h-16 rounded-full bg-error-container/30 border border-error/50 flex items-center justify-center text-error shadow-[0_0_20px_rgba(255,100,120,0.3)]">
                <XCircle className="w-8 h-8" />
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-black text-on-surface uppercase tracking-wide">
                  Rematch Declined
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                  <span className="text-primary-fixed-dim font-bold">{opponentName}</span> declined the rematch offer or left the match.
                </p>
              </div>

              <div className="w-full pt-2">
                <button
                  type="button"
                  onClick={onReturnToLobby}
                  className="w-full py-3 rounded-xl bg-surface-container-high border border-outline-variant hover:border-primary-fixed-dim text-on-surface font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                >
                  <Home className="w-4 h-4" />
                  Return to Lobby
                </button>
              </div>
            </>
          )}

          {/* 4. ACCEPTED */}
          {state === 'accepted' && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.4)]">
                <RotateCcw className="w-8 h-8 animate-spin" />
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-black text-on-surface uppercase tracking-wide">
                  Rematch Accepted!
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                  Setting up the new arena. Transferring players...
                </p>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
