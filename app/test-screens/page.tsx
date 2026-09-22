'use client';

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import RoundResultModal, { RoundResultModalProps } from '@/components/RoundResultModal';
import GameOverModal, { GameOverModalProps } from '@/components/GameOverModal';
import { 
  Trophy, 
  Crown, 
  Sparkles, 
  RotateCcw, 
  Play, 
  Sliders, 
  Layers, 
  CheckCircle2, 
  XCircle, 
  Scale, 
  Timer, 
  Zap,
  ArrowRight
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TestScreensPage() {
  const router = useRouter();

  // Modal active states
  const [activeModal, setActiveModal] = useState<'round' | 'gameover' | null>(null);

  // Round Result Modal Test State
  const [roundOutcome, setRoundOutcome] = useState<'win' | 'loss' | 'draw'>('win');
  const [roundNumber, setRoundNumber] = useState(3);
  const [roundTarget, setRoundTarget] = useState(486);
  const [isSolvable, setIsSolvable] = useState(true);
  const [countdownDuration, setCountdownDuration] = useState(5);

  // Game Over Modal Test State
  const [matchOutcome, setMatchOutcome] = useState<'player' | 'opponent' | 'draw'>('player');
  const [playerScore, setPlayerScore] = useState(5.20);
  const [opponentScore, setOpponentScore] = useState(3.85);
  const [mmrDelta, setMmrDelta] = useState(25);

  // Sample data for Round Modal
  const getRoundData = () => {
    if (roundOutcome === 'win') {
      return {
        target: roundTarget,
        outcome: 'win' as const,
        player: {
          name: 'Agent_Zero',
          result: roundTarget,
          diff: 0,
          timeMs: 14200,
          steps: [
            { a: 100, op: '×', b: 5, result: 500 },
            { a: 500, op: '−', b: 25, result: 475 },
            { a: 75, op: '÷', b: 7, result: 10 }, // placeholder math logic for display
            { a: 475, op: '+', b: 11, result: 486 },
          ],
          pointsEarned: 1.0,
          pointsRaw: 100,
          totalPoints: 3.20,
        },
        opponent: {
          name: 'CyberPhantom_99',
          result: roundTarget - 4,
          diff: 4,
          timeMs: 18700,
          steps: [
            { a: 100, op: '×', b: 5, result: 500 },
            { a: 500, op: '−', b: 18, result: 482 },
          ],
          pointsEarned: 0.35,
          pointsRaw: 35,
          totalPoints: 2.15,
        },
        solvability: {
          solvable: isSolvable,
          bestExpression: '((100 × 5) − 25 + 11) = 486',
          bestSteps: [
            '100 × 5 = 500',
            '500 − 25 = 475',
            '475 + 11 = 486 (Exact)',
          ],
        },
      };
    } else if (roundOutcome === 'loss') {
      return {
        target: roundTarget,
        outcome: 'loss' as const,
        player: {
          name: 'Agent_Zero',
          result: roundTarget + 12,
          diff: 12,
          timeMs: 25400,
          steps: [
            { a: 75, op: '×', b: 6, result: 450 },
            { a: 450, op: '+', b: 48, result: 498 },
          ],
          pointsEarned: 0.0,
          pointsRaw: 0,
          totalPoints: 2.20,
        },
        opponent: {
          name: 'CyberPhantom_99',
          result: roundTarget,
          diff: 0,
          timeMs: 12300,
          steps: [
            { a: 100, op: '×', b: 5, result: 500 },
            { a: 500, op: '−', b: 14, result: 486 },
          ],
          pointsEarned: 1.0,
          pointsRaw: 100,
          totalPoints: 4.15,
        },
        solvability: {
          solvable: isSolvable,
          bestExpression: '(100 × 5) − 14 = 486',
          bestSteps: ['100 × 5 = 500', '500 − 14 = 486 (Exact)'],
        },
      };
    } else {
      return {
        target: roundTarget,
        outcome: 'draw' as const,
        player: {
          name: 'Agent_Zero',
          result: roundTarget - 2,
          diff: 2,
          timeMs: 15100,
          steps: [
            { a: 50, op: '×', b: 9, result: 450 },
            { a: 450, op: '+', b: 34, result: 484 },
          ],
          pointsEarned: isSolvable ? 0.35 : 0.50,
          pointsRaw: isSolvable ? 35 : 50,
          totalPoints: 2.55,
        },
        opponent: {
          name: 'CyberPhantom_99',
          result: roundTarget + 2,
          diff: 2,
          timeMs: 15100,
          steps: [
            { a: 100, op: '×', b: 5, result: 500 },
            { a: 500, op: '−', b: 12, result: 488 },
          ],
          pointsEarned: isSolvable ? 0.35 : 0.50,
          pointsRaw: isSolvable ? 35 : 50,
          totalPoints: 2.55,
        },
        solvability: {
          solvable: isSolvable,
          bestExpression: isSolvable ? '((100 × 5) − 14) = 486' : 'Target unreachable — closest is 484 / 488',
          bestSteps: isSolvable ? ['100 × 5 = 500', '500 − 14 = 486'] : ['Best diff: 2 away'],
        },
      };
    }
  };

  const currentRoundData = getRoundData();

  const sampleRoundsHistory = [
    { round: 1, target: 352, playerResult: 352, opponentResult: 350, playerPoints: 1.0, opponentPoints: 0.35, winner: 'player' as const },
    { round: 2, target: 719, playerResult: 720, opponentResult: 719, playerPoints: 0.35, opponentPoints: 1.0, winner: 'opponent' as const },
    { round: 3, target: 486, playerResult: 486, opponentResult: 482, playerPoints: 1.0, opponentPoints: 0.35, winner: 'player' as const },
    { round: 4, target: 820, playerResult: 820, opponentResult: 818, playerPoints: 1.0, opponentPoints: 0.0, winner: 'player' as const },
    { round: 5, target: 605, playerResult: 605, opponentResult: 605, playerPoints: 0.85, opponentPoints: 0.85, winner: 'draw' as const },
  ];

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-primary-container/15 text-primary-fixed-dim border border-primary-fixed-dim/30">
              Interactive Screen Playground
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-on-background tracking-tight">
            Game Over & Round Result UI Sandbox
          </h1>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            Test and inspect the two newly designed game flow screens with different outcomes, scores, solvability states, and timers before backend integration.
          </p>
        </div>

        {/* Two Main Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Round Result Modal */}
          <div className="glass-panel rounded-2xl p-6 flex flex-col gap-5 border border-primary-fixed-dim/30 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary-fixed-dim">
                  <Trophy className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-lg text-on-surface">Screen 3: Round Result Modal</h2>
                  <p className="text-xs text-on-surface-variant">Post-round score breakdown & next countdown</p>
                </div>
              </div>
            </div>

            {/* Config options */}
            <div className="bg-surface-container-low/70 rounded-xl p-4 border border-outline-variant/20 flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1.5">
                <span className="text-on-surface-variant font-semibold uppercase tracking-wider text-[11px]">Outcome State</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setRoundOutcome('win')}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      roundOutcome === 'win'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Won
                  </button>
                  <button
                    onClick={() => setRoundOutcome('loss')}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      roundOutcome === 'loss'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Lost
                  </button>
                  <button
                    onClick={() => setRoundOutcome('draw')}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      roundOutcome === 'draw'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <Scale className="w-3.5 h-3.5" /> Draw
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-outline-variant/20">
                <div className="flex flex-col gap-1">
                  <label className="text-on-surface-variant font-medium">Target Number:</label>
                  <input
                    type="number"
                    value={roundTarget}
                    onChange={(e) => setRoundTarget(Number(e.target.value))}
                    className="bg-background border border-outline-variant/40 rounded-lg px-2.5 py-1.5 font-mono text-primary font-bold outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-on-surface-variant font-medium">Auto-Advance (Sec):</label>
                  <input
                    type="number"
                    value={countdownDuration}
                    onChange={(e) => setCountdownDuration(Number(e.target.value))}
                    className="bg-background border border-outline-variant/40 rounded-lg px-2.5 py-1.5 font-mono text-primary-fixed-dim font-bold outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-on-surface-variant font-medium">Solvable Target:</span>
                <button
                  type="button"
                  onClick={() => setIsSolvable(!isSolvable)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    isSolvable
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {isSolvable ? 'Yes (Solvable)' : 'No (Unsolvable)'}
                </button>
              </div>
            </div>

            {/* Launch Button */}
            <button
              onClick={() => setActiveModal('round')}
              className="mt-auto w-full py-3.5 rounded-xl bg-primary-container text-on-primary-container font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary transition-all shadow-[0_0_20px_rgba(0,229,255,0.4)] neon-glow cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Preview Round Result Modal</span>
            </button>
          </div>

          {/* Card 2: Game Over / Victory Screen */}
          <div className="glass-panel rounded-2xl p-6 flex flex-col gap-5 border border-secondary/30 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/30 flex items-center justify-center text-secondary">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-lg text-on-surface">Screen 4: Final Victory / Game Over</h2>
                  <p className="text-xs text-on-surface-variant">Match conclusion at 5.0 pts + MMR ranking update</p>
                </div>
              </div>
            </div>

            {/* Config options */}
            <div className="bg-surface-container-low/70 rounded-xl p-4 border border-outline-variant/20 flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1.5">
                <span className="text-on-surface-variant font-semibold uppercase tracking-wider text-[11px]">Match Winner</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setMatchOutcome('player');
                      setMmrDelta(25);
                      setPlayerScore(5.20);
                      setOpponentScore(3.85);
                    }}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      matchOutcome === 'player'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <Crown className="w-3.5 h-3.5" /> Victory
                  </button>
                  <button
                    onClick={() => {
                      setMatchOutcome('opponent');
                      setMmrDelta(-18);
                      setPlayerScore(3.20);
                      setOpponentScore(5.00);
                    }}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      matchOutcome === 'opponent'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Defeat
                  </button>
                  <button
                    onClick={() => {
                      setMatchOutcome('draw');
                      setMmrDelta(5);
                      setPlayerScore(5.00);
                      setOpponentScore(5.00);
                    }}
                    className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1 border transition-all ${
                      matchOutcome === 'draw'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                        : 'bg-surface-container-high border-outline-variant/40 text-on-surface hover:border-outline'
                    }`}
                  >
                    <Scale className="w-3.5 h-3.5" /> Draw
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-outline-variant/20">
                <div className="flex flex-col gap-1">
                  <label className="text-on-surface-variant font-medium">Your Score:</label>
                  <input
                    type="number"
                    step="0.05"
                    value={playerScore}
                    onChange={(e) => setPlayerScore(Number(e.target.value))}
                    className="bg-background border border-outline-variant/40 rounded-lg px-2.5 py-1.5 font-mono text-primary font-bold outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-on-surface-variant font-medium">Opponent Score:</label>
                  <input
                    type="number"
                    step="0.05"
                    value={opponentScore}
                    onChange={(e) => setOpponentScore(Number(e.target.value))}
                    className="bg-background border border-outline-variant/40 rounded-lg px-2.5 py-1.5 font-mono text-secondary font-bold outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-on-surface-variant font-medium">MMR Change:</span>
                <span className={`font-mono font-bold text-sm ${mmrDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mmrDelta >= 0 ? `+${mmrDelta}` : mmrDelta} MMR
                </span>
              </div>
            </div>

            {/* Launch Button */}
            <button
              onClick={() => setActiveModal('gameover')}
              className="mt-auto w-full py-3.5 rounded-xl bg-secondary-container/40 border border-secondary text-secondary-fixed font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-secondary-container/60 transition-all shadow-[0_0_20px_rgba(0,80,238,0.4)] cursor-pointer"
            >
              <Crown className="w-4 h-4" />
              <span>Preview Game Over Screen</span>
            </button>
          </div>
        </div>

        {/* Quick Links & Information */}
        <div className="glass-panel rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary-fixed-dim" />
            <p className="text-xs sm:text-sm text-on-surface-variant">
              Ready to plug into backend WebSocket round events (<code className="font-mono text-primary-fixed-dim">ROUND_SCORE_RESULT</code> & <code className="font-mono text-primary-fixed-dim">MATCH_OVER</code>).
            </p>
          </div>
          <button
            onClick={() => router.push('/game')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-fixed-dim hover:text-primary transition-colors underline"
          >
            Go to Active Game Board <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </main>

      {/* Render Active Modals */}
      {activeModal === 'round' && (
        <RoundResultModal
          isOpen={true}
          roundNumber={roundNumber}
          target={currentRoundData.target}
          outcome={currentRoundData.outcome}
          player={currentRoundData.player}
          opponent={currentRoundData.opponent}
          solvability={currentRoundData.solvability}
          countdownSeconds={countdownDuration}
          onNextRound={() => {
            alert('Auto-advance / Continue triggered: Next round would start!');
            setActiveModal(null);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'gameover' && (
        <GameOverModal
          isOpen={true}
          winner={matchOutcome}
          playerName="Agent_Zero"
          opponentName="CyberPhantom_99"
          playerFinalScore={playerScore}
          opponentFinalScore={opponentScore}
          roundsHistory={sampleRoundsHistory}
          mmrStats={{
            previousMmr: 1250,
            delta: mmrDelta,
            currentMmr: 1250 + mmrDelta,
            rankTier: 'Diamond Operative II',
            nextTierMmr: 1300,
          }}
          matchDurationSeconds={185}
          exactMatchesSolved={{ player: 3, totalRounds: 5 }}
          onReturnToLobby={() => {
            router.push('/lobby');
          }}
          onPlayAgain={() => {
            alert('Play Again triggered: Queuing for next match!');
            setActiveModal(null);
          }}
        />
      )}
    </div>
  );
}
