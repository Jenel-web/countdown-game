'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trophy, 
  Crown, 
  RotateCcw, 
  Home, 
  TrendingUp, 
  TrendingDown, 
  Award, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  Clock, 
  BarChart3,
  Sparkles,
  ChevronDown,
  ChevronUp,
  User,
  Swords
} from 'lucide-react';

export interface RoundHistoryItem {
  round: number;
  target: number;
  playerResult: number | null;
  opponentResult: number | null;
  playerPoints: number;    // e.g. 1.0
  opponentPoints: number;  // e.g. 0.35
  winner: 'player' | 'opponent' | 'draw';
}

export interface MMRStats {
  previousMmr: number;
  delta: number;          // e.g. +25 or -18
  currentMmr: number;     // previousMmr + delta
  rankTier?: string;      // e.g. "Diamond II", "Platinum I", "Gold III"
  nextTierMmr?: number;   // e.g. 1500
}

export interface GameOverModalProps {
  isOpen: boolean;
  winner: 'player' | 'opponent' | 'draw';
  playerName?: string;
  opponentName?: string;
  playerFinalScore: number;     // e.g. 5.2
  opponentFinalScore: number;   // e.g. 3.8
  roundsHistory?: RoundHistoryItem[];
  mmrStats: MMRStats;
  matchDurationSeconds?: number;
  exactMatchesSolved?: { player: number; totalRounds: number };
  onReturnToLobby: () => void;
  onPlayAgain: () => void;
}

export default function GameOverModal({
  isOpen,
  winner,
  playerName = 'Operative',
  opponentName = 'Opponent',
  playerFinalScore,
  opponentFinalScore,
  roundsHistory = [],
  mmrStats,
  matchDurationSeconds = 145,
  exactMatchesSolved = { player: 3, totalRounds: 5 },
  onReturnToLobby,
  onPlayAgain,
}: GameOverModalProps) {
  const [showRoundsBreakdown, setShowRoundsBreakdown] = useState(true);

  if (!isOpen) return null;

  const isVictory = winner === 'player';
  const isDefeat = winner === 'opponent';
  const isDraw = winner === 'draw';

  const formatDuration = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs}s`;
  };

  const bannerTheme = isVictory
    ? {
        title: 'VICTORY!',
        subtitle: 'You reached the 5-point match threshold first!',
        accentColor: 'text-primary-fixed-dim',
        bgGradient: 'from-primary-container/20 via-primary-fixed-dim/10 to-transparent',
        borderColor: 'border-primary-fixed-dim/60',
        glowShadow: 'shadow-[0_0_50px_rgba(0,240,255,0.4)]',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        icon: Crown,
      }
    : isDefeat
    ? {
        title: 'DEFEAT',
        subtitle: `${opponentName} reached the 5-point threshold first.`,
        accentColor: 'text-error',
        bgGradient: 'from-error-container/25 via-error/10 to-transparent',
        borderColor: 'border-error/50',
        glowShadow: 'shadow-[0_0_40px_rgba(255,100,120,0.3)]',
        badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        icon: XCircle,
      }
    : {
        title: 'MATCH DRAW',
        subtitle: 'Both operatives reached equal points at the threshold.',
        accentColor: 'text-secondary-fixed-dim',
        bgGradient: 'from-secondary-container/20 via-secondary/10 to-transparent',
        borderColor: 'border-secondary/50',
        glowShadow: 'shadow-[0_0_40px_rgba(182,196,255,0.3)]',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        icon: Award,
      };

  const BannerIcon = bannerTheme.icon;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.88, y: 30 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className={`relative w-full max-w-2xl bg-surface-container-low border ${bannerTheme.borderColor} ${bannerTheme.glowShadow} rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto`}
        >
          {/* Top Confetti / Ambient Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-40 bg-primary-container/15 blur-3xl pointer-events-none" />

          {/* 1. Match Winner Announcement Header */}
          <div className={`relative px-6 py-6 bg-gradient-to-b ${bannerTheme.bgGradient} border-b border-outline-variant/30 flex flex-col items-center text-center overflow-hidden`}>
            {/* Animated Trophy Icon */}
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
              className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 shadow-lg ${
                isVictory
                  ? 'bg-primary-container/20 text-primary-fixed-dim border border-primary-fixed-dim/50 shadow-[0_0_25px_rgba(0,240,255,0.5)]'
                  : isDefeat
                  ? 'bg-error-container/30 text-error border border-error/40 shadow-[0_0_20px_rgba(255,100,120,0.3)]'
                  : 'bg-secondary-container/30 text-secondary border border-secondary/40'
              }`}
            >
              <BannerIcon className="w-8 h-8" />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`text-3xl sm:text-4xl font-black tracking-tight ${bannerTheme.accentColor} uppercase`}
            >
              {bannerTheme.title}
            </motion.h1>

            <p className="text-xs sm:text-sm text-on-surface-variant mt-1 max-w-md font-medium">
              {bannerTheme.subtitle}
            </p>
          </div>

          {/* Body Content */}
          <div className="p-5 sm:p-6 flex flex-col gap-5 max-h-[68vh] overflow-y-auto">
            {/* 2. Final Score Breakdown Comparison Banner */}
            <div className="bg-surface-container/70 border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-3">
              <div className="text-center text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center justify-center gap-1.5">
                <Swords className="w-3.5 h-3.5 text-primary-fixed-dim" /> Final Match Score (First to 5.0 pts)
              </div>

              <div className="grid grid-cols-7 items-center gap-2">
                {/* Player Score Column */}
                <div className={`col-span-3 bg-surface-container-lowest/80 rounded-xl p-3.5 border flex flex-col items-center text-center ${
                  isVictory ? 'border-primary-fixed-dim/50 shadow-[0_0_15px_rgba(0,240,255,0.2)]' : 'border-outline-variant/20'
                }`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <User className="w-3.5 h-3.5 text-primary-fixed-dim" />
                    <span className="font-bold text-xs text-primary-fixed-dim truncate max-w-[100px]">
                      {playerName} (You)
                    </span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black font-mono text-on-surface">
                    {playerFinalScore.toFixed(2)}
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant mt-0.5">
                    {isVictory ? '🏆 Match Winner' : 'Total Points'}
                  </span>
                </div>

                {/* VS Divider */}
                <div className="col-span-1 flex flex-col items-center justify-center">
                  <span className="text-xs font-bold text-on-surface-variant/60 uppercase">VS</span>
                </div>

                {/* Opponent Score Column */}
                <div className={`col-span-3 bg-surface-container-lowest/80 rounded-xl p-3.5 border flex flex-col items-center text-center ${
                  isDefeat ? 'border-error/50 shadow-[0_0_15px_rgba(255,100,120,0.2)]' : 'border-outline-variant/20'
                }`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <User className="w-3.5 h-3.5 text-secondary" />
                    <span className="font-bold text-xs text-on-surface truncate max-w-[100px]">
                      {opponentName}
                    </span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black font-mono text-on-surface">
                    {opponentFinalScore.toFixed(2)}
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant mt-0.5">
                    {isDefeat ? '🏆 Match Winner' : 'Total Points'}
                  </span>
                </div>
              </div>

              {/* Quick Match Performance Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-outline-variant/20 text-center">
                <div className="bg-surface-container-lowest/40 rounded-lg p-2 flex flex-col items-center">
                  <span className="text-[10px] uppercase text-on-surface-variant font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3 text-primary-fixed-dim" /> Match Time
                  </span>
                  <span className="font-mono text-xs font-bold text-on-surface mt-0.5">
                    {formatDuration(matchDurationSeconds)}
                  </span>
                </div>

                <div className="bg-surface-container-lowest/40 rounded-lg p-2 flex flex-col items-center">
                  <span className="text-[10px] uppercase text-on-surface-variant font-medium flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-primary-fixed-dim" /> Exact Solutions
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-400 mt-0.5">
                    {exactMatchesSolved.player} / {exactMatchesSolved.totalRounds}
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-1 bg-surface-container-lowest/40 rounded-lg p-2 flex flex-col items-center">
                  <span className="text-[10px] uppercase text-on-surface-variant font-medium flex items-center gap-1">
                    <BarChart3 className="w-3 h-3 text-primary-fixed-dim" /> Total Rounds
                  </span>
                  <span className="font-mono text-xs font-bold text-on-surface mt-0.5">
                    {roundsHistory.length || exactMatchesSolved.totalRounds} Rounds
                  </span>
                </div>
              </div>
            </div>

            {/* 3. MMR Change Indicator Card */}
            <div className="bg-gradient-to-r from-surface-container to-surface-container-high border border-outline-variant/40 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-primary-fixed-dim" /> Rating & MMR Adjustment
                </span>
                {mmrStats.rankTier && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary-container/15 text-primary-fixed-dim border border-primary-fixed-dim/30">
                    {mmrStats.rankTier}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-container-lowest/70 p-3.5 rounded-xl border border-outline-variant/20">
                {/* Previous -> Current MMR */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-on-surface-variant">Previous MMR</span>
                    <span className="font-mono text-lg font-bold text-on-surface-variant">
                      {mmrStats.previousMmr}
                    </span>
                  </div>

                  <span className="text-on-surface-variant font-bold text-sm">→</span>

                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-on-surface-variant">Updated MMR</span>
                    <span className="font-mono text-2xl font-black text-on-surface">
                      {mmrStats.currentMmr}
                    </span>
                  </div>
                </div>

                {/* Delta Badge */}
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`px-4 py-2 rounded-xl font-mono font-black text-base flex items-center gap-1.5 border shadow-md ${
                    mmrStats.delta >= 0
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                  }`}
                >
                  {mmrStats.delta >= 0 ? (
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-rose-400" />
                  )}
                  <span>
                    {mmrStats.delta >= 0 ? `+${mmrStats.delta}` : mmrStats.delta} MMR
                  </span>
                </motion.div>
              </div>

              {/* Progress to next tier if available */}
              {mmrStats.nextTierMmr && (
                <div className="flex flex-col gap-1 text-[11px] text-on-surface-variant">
                  <div className="flex justify-between">
                    <span>Next Rank Milestone</span>
                    <span className="font-mono text-primary-fixed-dim">{mmrStats.currentMmr} / {mmrStats.nextTierMmr} MMR</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-container rounded-full"
                      style={{
                        width: `${Math.min(100, (mmrStats.currentMmr / mmrStats.nextTierMmr) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Detailed Round-by-Round History Accordion */}
            {roundsHistory.length > 0 && (
              <div className="bg-surface-container/50 border border-outline-variant/30 rounded-xl p-3.5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowRoundsBreakdown((prev) => !prev)}
                  className="flex items-center justify-between text-xs font-bold text-on-surface hover:text-primary-fixed-dim transition-colors"
                >
                  <span className="uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-primary-fixed-dim" /> Round-by-Round History ({roundsHistory.length} Rounds)
                  </span>
                  {showRoundsBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                <AnimatePresence>
                  {showRoundsBreakdown && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pt-2 flex flex-col gap-1.5"
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                          <thead>
                            <tr className="text-on-surface-variant/70 border-b border-outline-variant/30 text-[10px] uppercase">
                              <th className="py-1 px-2">Rnd</th>
                              <th className="py-1 px-2">Target</th>
                              <th className="py-1 px-2 text-primary-fixed-dim">You</th>
                              <th className="py-1 px-2 text-secondary">Opponent</th>
                              <th className="py-1 px-2 text-right">Pts Awarded</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-outline-variant/20">
                            {roundsHistory.map((rh) => (
                              <tr key={rh.round} className="hover:bg-surface-container-high/40 transition-colors">
                                <td className="py-2 px-2 font-bold text-on-surface">#{rh.round}</td>
                                <td className="py-2 px-2 text-on-surface-variant">{rh.target}</td>
                                <td className="py-2 px-2 font-bold text-primary-fixed-dim">
                                  {rh.playerResult ?? 'Timeout'}
                                </td>
                                <td className="py-2 px-2 text-on-surface">
                                  {rh.opponentResult ?? 'Timeout'}
                                </td>
                                <td className="py-2 px-2 text-right font-bold">
                                  <span className={rh.winner === 'player' ? 'text-emerald-400' : rh.winner === 'opponent' ? 'text-rose-400' : 'text-amber-400'}>
                                    +{rh.playerPoints.toFixed(2)} / +{rh.opponentPoints.toFixed(2)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* 4. Navigation Actions Footer */}
          <div className="p-4 sm:p-5 bg-surface-container-high/90 border-t border-outline-variant/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={onReturnToLobby}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-outline-variant hover:border-outline text-on-surface hover:bg-surface-variant transition-all font-bold text-xs uppercase tracking-wider cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>Return to Lobby</span>
            </button>

            <button
              type="button"
              onClick={onPlayAgain}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-primary-container text-on-primary-container font-bold text-xs uppercase tracking-wider hover:bg-primary transition-all shadow-[0_0_15px_rgba(0,229,255,0.4)] active:scale-95 neon-glow cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Play Again</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
