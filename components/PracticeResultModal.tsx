"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Target,
  TrendingUp,
  HelpCircle,
  Loader2,
  Users,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { BestSolution } from "@/lib/gameEngine";
import type {
  PracticeFeedback,
  PracticeCategory,
} from "@/lib/practiceFeedback";

export interface PracticeResultModalProps {
  isOpen: boolean;
  feedback: PracticeFeedback;
  target: number;
  /** Player's final value, or null if they had no valid solution. */
  result: number | null;
  stepsUsed: number;
  /** True when the round ended because the timer ran out. */
  timedOut: boolean;
  /** null while the solver is still running. */
  bestSolution: BestSolution | null;
  onTryRealMatch: () => void;
  onTryAgain: () => void;
}

/** Number of steps shown per column in the Best Solution grid. */
const STEPS_PER_COLUMN = 3;

const CATEGORY_STYLE: Record<
  PracticeCategory,
  {
    icon: typeof Trophy;
    text: string;
    border: string;
    glow: string;
    banner: string;
    iconBg: string;
  }
> = {
  exact: {
    icon: Trophy,
    text: "text-emerald-300",
    border: "border-emerald-400/50",
    glow: "shadow-[0_0_40px_rgba(52,211,153,0.25)]",
    banner: "from-emerald-500/20 via-[#00E5FF]/10 to-transparent",
    iconBg: "bg-emerald-500/15 border-emerald-400/40",
  },
  close: {
    icon: Target,
    text: "text-amber-300",
    border: "border-amber-400/50",
    glow: "shadow-[0_0_40px_rgba(251,191,36,0.2)]",
    banner: "from-amber-500/20 via-[#2962FF]/10 to-transparent",
    iconBg: "bg-amber-500/15 border-amber-400/40",
  },
  far: {
    icon: TrendingUp,
    text: "text-[#00E5FF]",
    border: "border-[#00E5FF]/40",
    glow: "shadow-[0_0_40px_rgba(0,229,255,0.2)]",
    banner: "from-[#2962FF]/25 via-[#00E5FF]/10 to-transparent",
    iconBg: "bg-[#00E5FF]/10 border-[#00E5FF]/40",
  },
  invalid: {
    icon: HelpCircle,
    text: "text-on-surface-variant",
    border: "border-[#2962FF]/40",
    glow: "shadow-[0_0_30px_rgba(41,98,255,0.15)]",
    banner: "from-[#2962FF]/15 via-transparent to-transparent",
    iconBg: "bg-[#2962FF]/10 border-[#2962FF]/40",
  },
};

function plural(n: number) {
  return `${n} step${n === 1 ? "" : "s"}`;
}

function buildStepsMessage(
  stepsUsed: number,
  best: BestSolution | null
): string | null {
  if (!best) return null;
  const shortest = best.steps.length;
  if (stepsUsed === shortest) {
    return `You used ${plural(stepsUsed)} — that's the shortest possible!`;
  }
  return `You used ${plural(stepsUsed)}; the shortest is ${shortest}.`;
}

export default function PracticeResultModal({
  isOpen,
  feedback,
  target,
  result,
  stepsUsed,
  timedOut,
  bestSolution,
  onTryRealMatch,
  onTryAgain,
}: PracticeResultModalProps) {
  const style = CATEGORY_STYLE[feedback.category];
  const Icon = style.icon;
  const diff = result === null ? null : Math.abs(result - target);
  const stepsMessage =
    feedback.category === "exact"
      ? buildStepsMessage(stepsUsed, bestSolution)
      : null;

  const stepCount = bestSolution?.steps.length ?? 0;
  const rowCount = Math.max(1, Math.min(STEPS_PER_COLUMN, stepCount));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="practice-result-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Practice result"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={`glass-panel relative w-full max-w-2xl my-auto rounded-2xl border ${style.border} ${style.glow} overflow-hidden`}
          >
            {/* ── Header banner ─────────────────────────────────────── */}
            <div
              className={`relative px-6 pt-6 pb-5 bg-gradient-to-b ${style.banner} border-b border-outline-variant/20 flex flex-col items-center text-center gap-1.5 overflow-hidden`}
            >
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00E5FF]/10 blur-3xl pointer-events-none" />

              {timedOut && (
                <span className="relative px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-error-container/30 text-error border border-error/40 mb-1">
                  Time&apos;s up
                </span>
              )}

              <div
                className={`relative w-14 h-14 rounded-full border-2 flex items-center justify-center mb-1 ${style.iconBg}`}
              >
                <Icon className={`w-7 h-7 ${style.text}`} />
              </div>

              <h2
                className={`relative text-2xl sm:text-3xl font-black tracking-tight ${style.text}`}
              >
                {feedback.title}
              </h2>
              <p className="relative text-sm text-on-surface-variant max-w-sm">
                {feedback.message}
              </p>

              {stepsMessage && (
                <div className="relative mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                  <Sparkles className="w-3.5 h-3.5" />
                  {stepsMessage}
                </div>
              )}
            </div>

            {/* ── Stat tiles ────────────────────────────────────────── */}
            <div className="px-6 pt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-[#0A192F]/70 border border-[#2962FF]/30 p-3 flex flex-col items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">
                  Target
                </span>
                <span className="font-mono text-2xl sm:text-3xl font-black text-[#00E5FF] mt-1 drop-shadow-[0_0_10px_rgba(0,229,255,0.45)]">
                  {target}
                </span>
              </div>
              <div className="rounded-xl bg-[#0A192F]/70 border border-[#2962FF]/30 p-3 flex flex-col items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">
                  Your Result
                </span>
                <span className="font-mono text-2xl sm:text-3xl font-black text-on-surface mt-1">
                  {result === null ? "—" : result}
                </span>
              </div>
              <div className="rounded-xl bg-[#0A192F]/70 border border-[#2962FF]/30 p-3 flex flex-col items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">
                  Difference
                </span>
                <span
                  className={`font-mono text-2xl sm:text-3xl font-black mt-1 ${style.text}`}
                >
                  {diff === null ? "—" : diff}
                </span>
              </div>
            </div>

            {/* ── Best solution ─────────────────────────────────────── */}
            <div className="px-6 py-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#00E5FF]">
                  lightbulb
                </span>
                <h3 className="font-label-caps text-label-caps text-on-background">
                  Best Solution
                </h3>
              </div>

              {!bestSolution ? (
                <div className="flex items-center gap-2 text-xs text-on-surface-variant py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-[#00E5FF]" />
                  Finding best solution…
                </div>
              ) : (
                <>
                  <p className="text-xs text-on-surface-variant">
                    {bestSolution.diff === 0
                      ? `Shortest way to reach the target · ${plural(
                          stepCount
                        )}`
                      : `No exact solution exists. Closest possible: ${bestSolution.finalValue} (off by ${bestSolution.diff})`}
                  </p>

                  {stepCount === 0 ? (
                    <p className="text-sm text-on-surface py-1">
                      {bestSolution.diff === 0
                        ? "The target is already one of your starting tiles."
                        : `The closest you can get is a starting tile: ${bestSolution.finalValue}.`}
                    </p>
                  ) : (
                    <ol
                      className="grid grid-flow-col auto-cols-fr gap-x-3 gap-y-2"
                      style={{ gridTemplateRows: `repeat(${rowCount}, auto)` }}
                    >
                      {bestSolution.steps.map((s, i) => {
                        const isLast = i === stepCount - 1;
                        return (
                          <li
                            key={i}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors ${
                              isLast
                                ? "bg-[#00E5FF]/10 border-[#00E5FF]/60 shadow-[0_0_14px_rgba(0,229,255,0.25)]"
                                : "bg-[#0A192F]/70 border-[#2962FF]/30"
                            }`}
                          >
                            <span
                              className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold font-mono ${
                                isLast
                                  ? "bg-[#00E5FF] text-[#0A192F]"
                                  : "bg-[#2962FF]/20 text-[#82B1FF]"
                              }`}
                            >
                              {i + 1}
                            </span>
                            <span className="font-mono text-sm text-on-surface whitespace-nowrap">
                              {s.a}{" "}
                              <span className="text-[#00E5FF] font-bold">
                                {s.op}
                              </span>{" "}
                              {s.b}{" "}
                              <span className="text-on-surface-variant">=</span>{" "}
                              <span
                                className={
                                  isLast
                                    ? "font-black text-[#00E5FF]"
                                    : "font-semibold"
                                }
                              >
                                {s.result}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>

            {/* ── Actions ───────────────────────────────────────────── */}
            <div className="px-6 py-4 bg-surface-container-high/60 border-t border-outline-variant/20 grid grid-cols-2 gap-3">
              <button
                onClick={onTryRealMatch}
                className="w-full bg-[#0A192F] border border-[#2962FF] hover:border-[#00E5FF] text-[#00E5FF] hover:bg-[#2962FF]/15 px-4 py-3 rounded-lg font-label-caps text-label-caps transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.15)] hover:shadow-[0_0_18px_rgba(0,229,255,0.3)]"
              >
                <Users className="w-4 h-4" />
                <span>Try on Real Match</span>
              </button>
              <button
                onClick={onTryAgain}
                className="w-full bg-primary-container text-on-primary-container hover:bg-primary px-4 py-3 rounded-lg font-label-caps text-label-caps transition-all duration-200 neon-glow flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
