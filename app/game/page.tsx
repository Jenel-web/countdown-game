'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { generateTilePool, generateTarget, applyOp, closestValue, Tile, Step } from '@/lib/gameEngine';

type Phase = 'IDLE' | 'SELECTING' | 'REVEALING' | 'PREPARING' | 'PLAYING' | 'DONE';

interface HistorySnapshot {
  availableTiles: Tile[];
  poolTiles: Tile[];
  workingHistory: Step[];
  activeOperator: '+' | '−' | '×' | '÷' | null;
  activeTile: Tile | null;
}

const PREP_SECONDS = 5;
const GAME_SECONDS = 30;

const tileVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.2, type: 'spring', stiffness: 260, damping: 20 },
  }),
};

function GameBoard() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [target, setTarget] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [poolTiles, setPoolTiles] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedOp, setSelectedOp] = useState<'+' | '−' | '×' | '÷' | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [prepCountdown, setPrepCountdown] = useState(PREP_SECONDS);
  const [gameTime, setGameTime] = useState(GAME_SECONDS);
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showNote = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  // REVEALING: stagger tiles one by one
  useEffect(() => {
    if (phase !== 'REVEALING') return;
    if (revealedCount >= tiles.length) {
      setTimeout(() => { setPrepCountdown(PREP_SECONDS); setPhase('PREPARING'); }, 300);
      return;
    }
    const t = setTimeout(() => setRevealedCount(c => c + 1), 200);
    return () => clearTimeout(t);
  }, [phase, revealedCount, tiles.length]);

  // PREPARING: 5-second countdown
  useEffect(() => {
    if (phase !== 'PREPARING') return;
    if (prepCountdown <= 0) {
      setGameTime(GAME_SECONDS);
      setPhase('PLAYING');
      const initialSnapshot: HistorySnapshot = {
        availableTiles: tiles,
        poolTiles: [],
        workingHistory: [],
        activeOperator: null,
        activeTile: null
      };
      setHistory([initialSnapshot]);
      return;
    }
    const t = setTimeout(() => setPrepCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, prepCountdown, tiles]);

  // PLAYING: game clock
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (gameTime <= 0) { showNote("Time's up!", 'error'); setPhase('DONE'); return; }
    const t = setTimeout(() => setGameTime(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, gameTime, showNote]);

  /**
   * Pushes a new snapshot of the board state onto the history stack.
   *
   * @param availableTiles - The list of initial tiles and their states.
   * @param poolTiles - The list of generated pool tiles.
   * @param workingHistory - The math steps performed so far.
   * @param activeOperator - The currently selected operator, if any.
   * @param activeTile - The currently selected tile, if any.
   * @returns void
   * @description Appends a new board state snapshot to the history stack to allow step-by-step undoing.
   */
  function pushStateToHistory(
    availableTiles: Tile[],
    poolTiles: Tile[],
    workingHistory: Step[],
    activeOperator: '+' | '−' | '×' | '÷' | null,
    activeTile: Tile | null
  ) {
    setHistory(prev => [
      ...prev,
      {
        availableTiles,
        poolTiles,
        workingHistory,
        activeOperator,
        activeTile,
      },
    ]);
  }

  /**
   * Starts a new game flow with a specific number of large pool tiles.
   *
   * @param count - Number of large tiles to select (0-4), or 'random'.
   * @returns void
   * @description Resets game states, generates target and tiles, and transitions to the REVEALING phase.
   */
  function startWithLarge(count: number | 'random') {
    const newTiles = generateTilePool(count);
    const newTarget = generateTarget();
    setTiles(newTiles);
    setTarget(newTarget);
    setPoolTiles([]);
    setSelectedTile(null);
    setSelectedOp(null);
    setSteps([]);
    setRevealedCount(0);
    setHistory([]);
    setPhase('REVEALING');
  }

  /**
   * Handles when a tile is clicked, performing selection, deselection, or equation execution.
   *
   * @param tile - The target tile data that was clicked.
   * @returns void
   * @description Manages selection state and triggers arithmetic calculations when two tiles and an operator are selected, saving results to history.
   */
  function handleTileClick(tile: Tile) {
    if (phase !== 'PLAYING' || tile.used) return;
    if (!selectedTile) {
      const nextTile = { ...tile, selected: true };
      const nextTiles = tiles.map(t => t.id === tile.id ? nextTile : t);
      const nextPool = poolTiles.map(t => t.id === tile.id ? nextTile : t);
      setSelectedTile(nextTile);
      if (tile.isGenerated) setPoolTiles(nextPool); else setTiles(nextTiles);
      pushStateToHistory(nextTiles, nextPool, steps, selectedOp, nextTile);
      return;
    }
    if (selectedTile.id === tile.id) {
      const nextTile = { ...tile, selected: false };
      const nextTiles = tiles.map(t => t.id === tile.id ? nextTile : t);
      const nextPool = poolTiles.map(t => t.id === tile.id ? nextTile : t);
      setSelectedTile(null);
      if (tile.isGenerated) setPoolTiles(nextPool); else setTiles(nextTiles);
      pushStateToHistory(nextTiles, nextPool, steps, selectedOp, null);
      return;
    }
    if (!selectedOp) {
      const prevTile = { ...selectedTile, selected: false };
      let nextTiles = tiles.map(t => t.id === selectedTile.id ? prevTile : t);
      let nextPool = poolTiles.map(t => t.id === selectedTile.id ? prevTile : t);

      const nextTile = { ...tile, selected: true };
      nextTiles = nextTiles.map(t => t.id === tile.id ? nextTile : t);
      nextPool = nextPool.map(t => t.id === tile.id ? nextTile : t);

      setSelectedTile(nextTile);
      setTiles(nextTiles);
      setPoolTiles(nextPool);
      pushStateToHistory(nextTiles, nextPool, steps, selectedOp, nextTile);
      return;
    }

    const result = applyOp(selectedTile.value, selectedOp, tile.value);
    if (result === null) { showNote('Invalid operation!', 'error'); return; }

    const nextStep: Step = { a: selectedTile.value, op: selectedOp, b: tile.value, result };
    const nextSteps = [...steps, nextStep];

    const markUsed = (l: Tile[]) => l.map(t => t.id === selectedTile.id || t.id === tile.id ? { ...t, used: true, selected: false } : t);
    const nextTiles = markUsed(tiles);
    const newGenTile: Tile = { id: `p_${Date.now()}`, value: result, used: false, selected: false, isGenerated: true };
    const nextPool = [...markUsed(poolTiles), newGenTile];

    setSteps(nextSteps);
    setTiles(nextTiles);
    setPoolTiles(nextPool);
    setSelectedTile(null);
    setSelectedOp(null);

    pushStateToHistory(nextTiles, nextPool, nextSteps, null, null);
    if (result === target) showNote('🎯 Exact match!', 'success');
  }

  /**
   * Helper function to update selection state of a tile inside the components.
   *
   * @param tile - The tile whose selection is being updated.
   * @param sel - The next selection state boolean.
   * @returns void
   * @description Updates the target tile status to selected or deselected in either initial or pool state arrays.
   */
  function updateSel(tile: Tile, sel: boolean) {
    if (tile.isGenerated) setPoolTiles(p => p.map(t => t.id === tile.id ? { ...t, selected: sel } : t));
    else setTiles(p => p.map(t => t.id === tile.id ? { ...t, selected: sel } : t));
  }

  /**
   * Handles user selection of an operator during active gameplay.
   *
   * @param op - The operator string ('+', '−', '×', '÷') selected by the user.
   * @returns void
   * @description Sets the active operator and pushes the updated board snapshot onto the history stack.
   */
  function handleOp(op: '+' | '−' | '×' | '÷') {
    if (phase !== 'PLAYING' || !selectedTile) return;
    const nextOp = selectedOp === op ? null : op;
    setSelectedOp(nextOp);
    pushStateToHistory(tiles, poolTiles, steps, nextOp, selectedTile);
  }

  /**
   * Reverts the game board to the immediate previous state by popping the latest snapshot.
   *
   * @returns void
   * @description Pops the top state from the history stack and restores the prior snapshot's tiles, steps, active tile, and operator.
   */
  function handleUndo() {
    if (history.length <= 1) return;
    const newHistory = history.slice(0, -1);
    const prevState = newHistory[newHistory.length - 1];

    setTiles(prevState.availableTiles);
    setPoolTiles(prevState.poolTiles);
    setSteps(prevState.workingHistory);
    setSelectedOp(prevState.activeOperator);
    setSelectedTile(prevState.activeTile);
    setHistory(newHistory);
  }

  /**
   * Reverts the math board back to the initial state (Step 0) immediately after preparation.
   *
   * @returns void
   * @description Restores original tiles, clears intermediate pool tiles, working history, and active selections, keeping the game timer running.
   */
  function handleClear() {
    if (history.length === 0) return;
    const step0 = history[0];
    setTiles(step0.availableTiles);
    setPoolTiles(step0.poolTiles);
    setSteps(step0.workingHistory);
    setSelectedTile(step0.activeTile);
    setSelectedOp(step0.activeOperator);
    setHistory([step0]);
  }

  /**
   * Submits the current closest calculation result to complete the game.
   *
   * @returns void
   * @description Finds the closest value to the target in the remaining tiles and transitions phase to DONE.
   */
  function handleSubmit() {
    const all = [...tiles, ...poolTiles];
    const { value, diff } = closestValue(all, target);
    showNote(diff === 0 ? '🏆 Solved!' : `Closest: ${value} (off by ${diff})`, diff === 0 ? 'success' : 'error');
    setPhase('DONE');
  }

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const timerPct = (gameTime / GAME_SECONDS) * 100;

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md">
      <Navbar />

      {/* Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg font-bold text-sm tracking-wider shadow-lg ${
              notification.type === 'success' ? 'bg-primary-container text-on-primary-container border border-primary-fixed-dim shadow-[0_0_15px_rgba(0,240,255,0.4)]'
              : notification.type === 'info' ? 'bg-surface-container-high text-on-surface border border-outline-variant'
              : 'bg-error-container text-on-error-container border border-error'
            }`}>{notification.msg}</motion.div>
        )}
      </AnimatePresence>

      {/* LARGE NUMBER SELECTION MODAL */}
      <AnimatePresence>
        {phase === 'SELECTING' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }}
              className="glass-panel rounded-2xl p-8 max-w-md w-full mx-4 border border-primary-fixed-dim/30 shadow-[0_0_40px_rgba(0,240,255,0.15)]">
              <h2 className="text-center font-bold text-2xl text-primary-fixed-dim mb-2 tracking-tight">How many large numbers?</h2>
              <p className="text-center text-on-surface-variant text-sm mb-8">Large pool: 25, 50, 75, 100</p>
              <div className="grid grid-cols-3 gap-3">
                {([0, 1, 2, 3, 4, 'random'] as (number | 'random')[]).map((v) => (
                  <button key={String(v)} onClick={() => startWithLarge(v)}
                    className={`py-4 rounded-xl font-bold text-lg border transition-all hover:scale-105 active:scale-95 ${
                      v === 'random'
                        ? 'col-span-3 bg-primary-container text-on-primary-container border-primary-fixed-dim shadow-[0_0_12px_rgba(0,240,255,0.3)] neon-glow'
                        : 'bg-surface-container-high border-outline-variant/50 text-on-surface hover:border-primary hover:shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                    }`}>
                    {v === 'random' ? '🎲 Random' : `${v} Large`}
                  </button>
                ))}
              </div>
              <button onClick={() => setPhase('IDLE')} className="mt-6 w-full text-center text-on-surface-variant text-sm hover:text-on-surface transition-colors">Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PREPARE OVERLAY */}
      <AnimatePresence>
        {phase === 'PREPARING' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
            <motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-on-surface-variant font-bold tracking-[0.4em] text-lg mb-4 uppercase">Prepare</motion.p>
            <motion.div
              key={prepCountdown}
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="text-[8rem] font-black text-primary-fixed-dim leading-none"
              style={{ textShadow: '0 0 40px #00F0FF, 0 0 80px rgba(0,240,255,0.4)' }}
            >
              {prepCountdown}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col w-full max-w-[900px] mx-auto px-4 py-6 gap-4">

        {/* Target + Timer */}
        <div className="glass-panel rounded-xl p-6 flex flex-col items-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.06),transparent)] pointer-events-none" />
          <div className="flex w-full justify-between items-center mb-3">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Target Number</span>
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">timer</span>
              {phase === 'PLAYING' || phase === 'DONE' ? fmt(gameTime) : '--:--'}
            </span>
          </div>
          <div className={`text-7xl font-black text-primary-container tracking-tighter mb-4 transition-all duration-500 ${phase === 'IDLE' || phase === 'SELECTING' ? 'blur-2xl opacity-0' : phase === 'REVEALING' || phase === 'PREPARING' ? 'blur-xl' : ''}`}
            style={{ textShadow: phase === 'PLAYING' ? '0 0 30px #00F0FF' : undefined }}>
            {target || '???'}
          </div>
          <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
            <motion.div className="h-full bg-primary-container rounded-full shadow-[0_0_10px_#00f0ff]"
              animate={{ width: phase === 'PLAYING' ? `${timerPct}%` : phase === 'DONE' ? '0%' : '100%' }}
              transition={{ duration: 1, ease: 'linear' }} />
          </div>
        </div>

        {/* Calculation Log */}
        <div className="glass-panel rounded-xl p-4 min-h-[100px] flex flex-col">
          <div className="text-on-surface-variant text-xs font-bold uppercase tracking-widest mb-3">Calculation Log</div>
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
            {steps.length === 0 && !selectedTile && (
              <p className="text-on-surface-variant/40 text-sm italic">Select a tile and an operator to begin…</p>
            )}
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-mono w-12 text-right text-on-surface">{s.a}</span>
                <span className="text-primary-fixed-dim font-bold w-4 text-center">{s.op}</span>
                <span className="font-mono w-12 text-on-surface">{s.b}</span>
                <span className="text-on-surface-variant">=</span>
                <span className={`font-mono font-bold ${s.result === target ? 'text-primary' : 'text-on-surface'}`}>{s.result}</span>
                {s.result === target && <span className="text-xs text-primary animate-pulse ml-1">✓ Target!</span>}
              </div>
            ))}
            {selectedTile && (
              <div className="flex items-center gap-3 text-sm bg-surface-container/50 p-2 rounded-lg border border-primary-fixed-dim/30">
                <span className="font-mono w-12 text-right text-on-surface">{selectedTile.value}</span>
                {selectedOp
                  ? <><span className="text-primary-fixed-dim font-bold w-4 text-center">{selectedOp}</span><span className="w-12 h-6 border-b-2 border-primary-fixed-dim animate-pulse" /></>
                  : <span className="text-on-surface-variant/60 text-xs italic ml-2">← pick operator</span>}
              </div>
            )}
          </div>
        </div>

        {/* Controls Panel */}
        <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">
          {/* Operators */}
          <div className="flex justify-center gap-4">
            {(['+', '−', '×', '÷'] as const).map(op => (
              <button key={op} onClick={() => handleOp(op)}
                disabled={phase !== 'PLAYING' || !selectedTile}
                className={`w-14 h-14 rounded-xl border font-bold text-xl transition-all disabled:opacity-30 disabled:pointer-events-none ${
                  selectedOp === op
                    ? 'bg-primary-container border-primary-fixed-dim text-on-primary-container shadow-[0_0_14px_rgba(0,240,255,0.5)]'
                    : 'bg-surface-variant/30 border-outline-variant hover:border-primary-fixed-dim hover:text-primary-fixed-dim'
                }`}>{op}</button>
            ))}
          </div>

          {/* Initial tiles with staggered animation */}
          <div className="grid grid-cols-6 gap-3">
            {phase === 'IDLE' || phase === 'SELECTING'
              ? Array(6).fill(null).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-surface-container-high border border-outline-variant/20 opacity-30" />
                ))
              : tiles.map((tile, i) => {
                  const visible = i < revealedCount || phase === 'PLAYING' || phase === 'DONE';
                  const isSel = selectedTile?.id === tile.id;
                  return (
                    <motion.button key={tile.id} custom={i} variants={tileVariants}
                      initial="hidden" animate={visible ? 'visible' : 'hidden'}
                      onClick={() => handleTileClick(tile)}
                      disabled={phase !== 'PLAYING' || tile.used}
                      className={`aspect-square rounded-xl border font-bold text-lg flex items-center justify-center transition-all ${
                        tile.used ? 'opacity-25 cursor-not-allowed bg-surface-container-lowest border-outline-variant/10'
                        : isSel ? 'border-primary bg-surface-container-highest shadow-[0_0_14px_rgba(0,240,255,0.6)] text-primary scale-105'
                        : 'bg-surface-container-high border-outline-variant/50 hover:border-primary hover:shadow-[0_0_8px_rgba(0,240,255,0.3)] hover:scale-105'
                      }`}>{tile.value}</motion.button>
                  );
                })}
          </div>

          {/* Pool tiles */}
          {poolTiles.filter(t => !t.used).length > 0 && (
            <div className="flex flex-wrap gap-3">
              {poolTiles.map(tile => {
                if (tile.used) return null;
                const isSel = selectedTile?.id === tile.id;
                return (
                  <motion.button key={tile.id} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    onClick={() => handleTileClick(tile)} disabled={phase !== 'PLAYING'}
                    className={`px-5 py-2 rounded-xl border font-bold transition-all ${
                      isSel ? 'border-primary bg-secondary-container/40 text-primary shadow-[0_0_14px_rgba(0,240,255,0.6)] scale-105'
                      : 'border-secondary/40 bg-secondary-container/20 text-secondary hover:bg-secondary-container/40 hover:scale-105'
                    }`}>{tile.value}</motion.button>
                );
              })}
            </div>
          )}

          {/* Action row */}
          <div className="flex gap-3">
            <button onClick={handleUndo} disabled={phase !== 'PLAYING' || history.length <= 1}
              className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface hover:bg-surface-variant transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2 disabled:opacity-40 disabled:pointer-events-none">
              <span className="material-symbols-outlined text-[18px]">undo</span> Undo
            </button>
            {phase === 'PLAYING' && (
              <button onClick={handleClear}
                className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface hover:bg-error-container hover:text-on-error-container hover:border-error transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">restart_alt</span> Clear
              </button>
            )}
            {phase === 'IDLE' || phase === 'DONE' ? (
              <button onClick={() => setPhase('SELECTING')}
                className="flex-[3] py-3 rounded-xl bg-primary-container text-on-primary-container hover:bg-primary transition-all font-bold text-sm uppercase tracking-wider neon-glow flex justify-center items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                {phase === 'DONE' ? 'Play Again' : 'Start Game'}
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={phase !== 'PLAYING'}
                className="flex-[2] py-3 rounded-xl bg-primary-container text-on-primary-container hover:bg-primary transition-all font-bold text-sm uppercase tracking-wider neon-glow flex justify-center items-center gap-2 disabled:opacity-40">
                Submit <span className="material-symbols-outlined text-[18px]">check</span>
              </button>
            )}
            <button onClick={() => router.push('/lobby')} className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface-variant hover:text-error hover:border-error transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>}>
      <GameBoard />
    </Suspense>
  );
}
