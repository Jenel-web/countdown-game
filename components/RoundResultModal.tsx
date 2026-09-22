'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trophy, 
  XCircle, 
  Scale, 
  Clock, 
  CheckCircle2, 
  HelpCircle, 
  ChevronDown, 
  ChevronUp, 
  ArrowRight, 
  Sparkles,
  Zap,
  Target,
  User,
  ShieldAlert
} from 'lucide-react';

export interface CalculationStep {
  a: number;
  op: string;
  b: number;
  result: number;
}

export interface PlayerRoundData {
  name: string;
  avatarUrl?: string;
  result: number | null; // Final number reached; null if timeout
  diff: number | null;   // Distance to target; null if timeout
  timeMs: number | null; // e.g. 14200 for 14.2s
  steps: CalculationStep[] | string[];
  pointsEarned: number;  // Decimal, e.g. 1.0 or 0.7
  pointsRaw: number;     // Integer, e.g. 100 or 70
  totalPoints: number;   // Cumulative match score, e.g. 3.2
}

export interface RoundResultModalProps {
  isOpen: boolean;
  roundNumber?: number;
  target: number;
  outcome: 'win' | 'loss' | 'draw';
  player: PlayerRoundData;
  opponent: PlayerRoundData;
  solvability: {
    solvable: boolean;
    bestExpression?: string;
    bestSteps?: string[];
  };
  countdownSeconds?: number;
  onNextRound: () => void;
  onClose?: () => void;
}

export default function RoundResultModal({
  isOpen,
  roundNumber = 1,
  target,
  outcome,
  player,
  opponent,
  solvability,
  countdownSeconds = 5,
  onNextRound,
  onClose,
}: RoundResultModalProps) {
  const [showBestSolution, setShowBestSolution] = useState(false);
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);
  const [isPaused, setIsPaused] = useState(false);

  // Reset timer whenever modal opens or countdownSeconds changes
  useEffect(() => {
    if (isOpen) {
      setTimeLeft(countdownSeconds);
      setIsPaused(false);
      setShowBestSolution(false);
    }
  }, [isOpen, countdownSeconds]);

  // 5-second auto-advance timer
  useEffect(() => {
    if (!isOpen || isPaused) return;

    if (timeLeft <= 0) {
      onNextRound();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, timeLeft, isPaused, onNextRound]);

  if (!isOpen) return null;

  const formatTime = (ms: number | null) => {
    if (ms === null || ms === undefined) return 'Timed Out';
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getBannerConfig = () => {
    switch (outcome) {
      case 'win':
        return {
          title: 'ROUND WON!',
          subtitle: 'Superior calculation speed & accuracy',
          bgGradient: 'from-emerald-500/20 via-primary-container/20 to-transparent',
          borderColor: 'border-primary-fixed-dim/60',
          textColor: 'text-primary-fixed-dim',
          badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          glowClass: 'shadow-[0_0_35px_rgba(0,240,255,0.35)]',
          icon: Trophy,
        };
      case 'loss':
        return {
          title: 'ROUND LOST',
          subtitle: 'Opponent was closer or submitted faster',
          bgGradient: 'from-rose-500/20 via-error-container/20 to-transparent',
          borderColor: 'border-error/60',
          textColor: 'text-error',
          badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          glowClass: 'shadow-[0_0_35px_rgba(255,100,120,0.3)]',
          icon: XCircle,
        };
      case 'draw':
      default:
        return {
          title: 'ROUND DRAW',
          subtitle: 'Evenly matched results this round',
          bgGradient: 'from-amber-500/20 via-secondary-container/20 to-transparent',
          borderColor: 'border-secondary/60',
          textColor: 'text-secondary-fixed-dim',
          badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          glowClass: 'shadow-[0_0_35px_rgba(182,196,255,0.3)]',
          icon: Scale,
        };
    }
  };

  const banner = getBannerConfig();
  const BannerIcon = banner.icon;

  const renderSteps = (steps: CalculationStep[] | string[]) => {
    if (!steps || steps.length === 0) {
      return (
        <span className="text-on-surface-variant/50 text-xs italic">
          No arithmetic operations performed
        </span>
      );
    }

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {steps.map((step, idx) => {
          if (typeof step === 'string') {
            return (
              <div
                key={idx}
                className="font-mono text-xs text-on-surface bg-surface-container-lowest/80 px-2.5 py-1 rounded border border-outline-variant/30 flex items-center justify-between"
              >
                <span>{step}</span>
              </div>
            );
          }
          return (
            <div
              key={idx}
              className="font-mono text-xs text-on-surface bg-surface-container-lowest/80 px-2.5 py-1 rounded border border-outline-variant/30 flex items-center justify-between"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-on-surface font-semibold">{step.a}</span>
                <span className="text-primary-fixed-dim font-bold">{step.op}</span>
                <span className="text-on-surface font-semibold">{step.b}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-on-surface-variant/60">=</span>
                <span className={`font-bold ${step.result === target ? 'text-primary' : 'text-on-surface'}`}>
                  {step.result}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`relative w-full max-w-2xl bg-surface-container-low border ${banner.borderColor} ${banner.glowClass} rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto`}
        >
          {/* Header Banner */}
          <div className={`relative px-6 py-5 bg-gradient-to-b ${banner.bgGradient} border-b border-outline-variant/30 flex flex-col items-center text-center overflow-hidden`}>
            {/* Background Glow Ring */}
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-32 bg-primary-container/15 blur-3xl pointer-events-none" />

            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-surface-container-highest/80 text-on-surface-variant border border-outline-variant/40">
                Round {roundNumber}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-surface-container-highest/80 text-primary-fixed-dim border border-primary-fixed-dim/30 flex items-center gap-1">
                <Target className="w-3 h-3" /> Target: {target}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-1">
              <BannerIcon className={`w-8 h-8 ${banner.textColor} animate-bounce`} />
              <h2 className={`text-2xl sm:text-3xl font-black tracking-tight ${banner.textColor}`}>
                {banner.title}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-on-surface-variant mt-1 font-medium">
              {banner.subtitle}
            </p>
          </div>

          {/* Body Content */}
          <div className="p-5 sm:p-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
            {/* Score & Submission Comparison Table */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* YOUR ANSWER CARD */}
              <div className="bg-surface-container/70 border border-primary-fixed-dim/30 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden shadow-inner">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary-container/5 rounded-full blur-xl pointer-events-none" />
                <div className="flex items-center justify-between pb-2 border-b border-outline-variant/20">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary-container/20 flex items-center justify-center text-primary-fixed-dim font-bold text-xs">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-bold text-sm text-primary-fixed-dim">
                      {player.name} (You)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                    <Clock className="w-3.5 h-3.5 text-primary-fixed-dim" />
                    <span>{formatTime(player.timeMs)}</span>
                  </div>
                </div>

                {/* Number Reached */}
                <div className="flex items-baseline justify-between bg-surface-container-lowest/60 px-3 py-2 rounded-lg border border-outline-variant/20">
                  <span className="text-xs text-on-surface-variant uppercase font-medium">Reached</span>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-mono font-black ${player.result === target ? 'text-primary' : 'text-on-surface'}`}>
                      {player.result !== null ? player.result : '---'}
                    </span>
                    {player.result !== null && (
                      <span className={`text-xs font-semibold ${player.diff === 0 ? 'text-emerald-400' : 'text-on-surface-variant'}`}>
                        {player.diff === 0 ? '(Exact 🎯)' : `(Diff: ${player.diff})`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Calculation Steps */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Solution Steps
                  </span>
                  <div className="max-h-28 overflow-y-auto pr-1">
                    {renderSteps(player.steps)}
                  </div>
                </div>

                {/* Points Earned */}
                <div className="mt-auto pt-2 border-t border-outline-variant/20 flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">Round Points:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-bold text-primary-fixed-dim">
                      +{player.pointsEarned.toFixed(2)} pts
                    </span>
                    <span className="text-[10px] text-on-surface-variant/70 font-mono">
                      ({player.pointsRaw} raw)
                    </span>
                  </div>
                </div>
              </div>

              {/* OPPONENT'S ANSWER CARD */}
              <div className="bg-surface-container/70 border border-outline-variant/40 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden shadow-inner">
                <div className="flex items-center justify-between pb-2 border-b border-outline-variant/20">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-secondary-container/30 flex items-center justify-center text-secondary font-bold text-xs">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-bold text-sm text-on-surface">
                      {opponent.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                    <Clock className="w-3.5 h-3.5 text-secondary" />
                    <span>{formatTime(opponent.timeMs)}</span>
                  </div>
                </div>

                {/* Number Reached */}
                <div className="flex items-baseline justify-between bg-surface-container-lowest/60 px-3 py-2 rounded-lg border border-outline-variant/20">
                  <span className="text-xs text-on-surface-variant uppercase font-medium">Reached</span>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-mono font-black ${opponent.result === target ? 'text-secondary' : 'text-on-surface'}`}>
                      {opponent.result !== null ? opponent.result : '---'}
                    </span>
                    {opponent.result !== null && (
                      <span className={`text-xs font-semibold ${opponent.diff === 0 ? 'text-emerald-400' : 'text-on-surface-variant'}`}>
                        {opponent.diff === 0 ? '(Exact 🎯)' : `(Diff: ${opponent.diff})`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Calculation Steps */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Solution Steps
                  </span>
                  <div className="max-h-28 overflow-y-auto pr-1">
                    {renderSteps(opponent.steps)}
                  </div>
                </div>

                {/* Points Earned */}
                <div className="mt-auto pt-2 border-t border-outline-variant/20 flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">Round Points:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-bold text-secondary">
                      +{opponent.pointsEarned.toFixed(2)} pts
                    </span>
                    <span className="text-[10px] text-on-surface-variant/70 font-mono">
                      ({opponent.pointsRaw} raw)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Solvability Indicator & Show Best Solution Toggle */}
            <div className="bg-surface-container-high/60 border border-outline-variant/40 rounded-xl p-3.5 flex flex-col gap-2.5 transition-all">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {solvability.solvable ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Exact Target Was Solvable</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                      <span>Target Was Unsolvable (Best Approximation Allowed)</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setShowBestSolution((prev) => !prev)}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-primary-fixed-dim hover:text-primary transition-colors bg-primary-container/10 hover:bg-primary-container/20 px-3 py-1.5 rounded-lg border border-primary-fixed-dim/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{showBestSolution ? 'Hide Best Solution' : 'Show Best Solution'}</span>
                  {showBestSolution ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Expandable Best Solution Drawer */}
              <AnimatePresence>
                {showBestSolution && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-outline-variant/30 pt-2.5 mt-1"
                  >
                    <div className="bg-surface-container-lowest/90 rounded-lg p-3 border border-outline-variant/20 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs text-on-surface-variant">
                        <span className="font-semibold uppercase tracking-wider text-[10px]">Optimal Formula</span>
                        <span className="font-mono text-primary-fixed-dim text-xs">
                          {solvability.solvable ? '100% Target Match' : 'Closest Possible Math'}
                        </span>
                      </div>
                      <div className="font-mono text-sm text-primary font-bold bg-background/80 px-3 py-2 rounded border border-primary-fixed-dim/30 break-all">
                        {solvability.bestExpression || 'No solution expression available'}
                      </div>
                      {solvability.bestSteps && solvability.bestSteps.length > 0 && (
                        <div className="flex flex-col gap-1 mt-1">
                          <span className="text-[10px] text-on-surface-variant uppercase font-medium">Step Breakdown:</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-xs text-on-surface">
                            {solvability.bestSteps.map((stepStr, idx) => (
                              <div key={idx} className="bg-surface-container/60 px-2 py-1 rounded border border-outline-variant/20">
                                {idx + 1}. {stepStr}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Match Progression / Standings Bar */}
            <div className="bg-surface-container/50 border border-outline-variant/30 rounded-xl p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-on-surface-variant uppercase tracking-wider text-[11px] flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-primary-fixed-dim" /> Match Standings (Race to 5.0 pts)
                </span>
                <span className="font-mono font-bold text-xs text-primary-fixed-dim">
                  {player.totalPoints.toFixed(2)} - {opponent.totalPoints.toFixed(2)}
                </span>
              </div>
              {/* Head to head progress bar */}
              <div className="w-full h-2.5 bg-surface-container-highest rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-primary-container to-primary-fixed-dim shadow-[0_0_10px_#00e5ff] transition-all duration-500"
                  style={{ width: `${Math.min(100, (player.totalPoints / 5.0) * 100)}%` }}
                  title={`${player.name}: ${player.totalPoints.toFixed(2)} / 5.0`}
                />
              </div>
              <div className="flex justify-between text-[11px] text-on-surface-variant/80 font-mono">
                <span>{player.name}: {player.totalPoints.toFixed(2)} pts</span>
                <span>{opponent.name}: {opponent.totalPoints.toFixed(2)} pts</span>
              </div>
            </div>
          </div>

          {/* Footer Actions & 5-Second Countdown */}
          <div className="p-4 sm:p-5 bg-surface-container-high/90 border-t border-outline-variant/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Auto-advance Countdown Indicator */}
            <div className="flex items-center gap-2.5 text-xs text-on-surface-variant">
              <div className="relative flex items-center justify-center w-7 h-7">
                <svg className="w-7 h-7 transform -rotate-90">
                  <circle
                    cx="14"
                    cy="14"
                    r="11"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="transparent"
                    className="text-surface-container-highest"
                  />
                  <circle
                    cx="14"
                    cy="14"
                    r="11"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 11}
                    strokeDashoffset={2 * Math.PI * 11 * (1 - timeLeft / countdownSeconds)}
                    className="text-primary-fixed-dim transition-all duration-1000 ease-linear"
                  />
                </svg>
                <span className="absolute font-mono font-bold text-[11px] text-primary-fixed-dim">
                  {timeLeft}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-on-surface">
                  {timeLeft > 0 ? `Next round in ${timeLeft}s...` : 'Starting next round...'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsPaused((p) => !p)}
                  className="text-[10px] text-on-surface-variant/70 hover:text-primary-fixed-dim underline text-left transition-colors"
                >
                  {isPaused ? 'Resume auto-advance' : 'Pause timer to review'}
                </button>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onNextRound}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-primary-container text-on-primary-container font-bold text-sm uppercase tracking-wider hover:bg-primary transition-all shadow-[0_0_15px_rgba(0,229,255,0.4)] active:scale-95 neon-glow cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
