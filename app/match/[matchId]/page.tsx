'use client';

/**
 * app/match/[matchId]/page.tsx
 *
 * Multiplayer game page for Countdown Math Arena.
 *
 * STATE MACHINE (spec §7):
 *
 *   WAITING_LOBBY ──► PREPARING ──► PLAYING ──► ROUND_RESULT ──► PLAYING (loop)
 *        │                                           │
 *        │ (opponent_left)                    (match_over)
 *        ▼                                           ▼
 *   opponent_left modal                         GAME_OVER
 *
 *   Any phase ──► ERROR (via error event or reconnect_failed)
 *
 * RULES ENFORCED:
 *   1. join_room only emitted when matchId + isConnected + userId are all ready
 *   2. Timer = server startTimestamp + durationMs (never local countdown)
 *   3. Auto-submit guarded by hasAutoSubmitted ref (fires exactly once per round)
 *   4. hasAutoSubmitted reset on every round_start alongside workspace state
 *   5. player_status 'submitted' NOT emitted manually — server does it (roundHandlers:271)
 *   6. opponent_left → WaitingLobby 'opponent_left' phase (self-sufficient, no match_over)
 *   7. match_over ONLY wired for standard full-game completion
 *   8. ROUND_RESULT phase held until server sends round_start or match_over
 *   9. mySlot stored in useRef, derived from opponent_joined vs Supabase userId
 */

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { applyOp } from '@/lib/gameEngine';
import { destroySocket } from '@/lib/socket/socketClient';
import { AutoGameSocketProvider, useGameSocketContext } from '@/context/GameSocketContext';
import { useGameSocket, useSocketEvent, useJoinRoom } from '@/hooks/useGameSocket';
import { useRoundTimer, formatTimerDisplay } from '@/hooks/useRoundTimer';
import Navbar from '@/components/Navbar';
import ErrorModal, { ERROR_CONFIGS } from '@/components/ErrorModal';
import type { ErrorModalConfig } from '@/components/ErrorModal';
import WaitingLobby from '@/components/WaitingLobby';
import type { WaitingPhase } from '@/components/WaitingLobby';
import ReconnectBanner from '@/components/ReconnectBanner';
import { OpponentScoreHeader } from '@/components/OpponentStatusBadge';
import RoundResultModal from '@/components/RoundResultModal';
import GameOverModal from '@/components/GameOverModal';
import type {
  Tile,
  Step,
  PlayerSlot,
  ServerErrorCode,
} from '@/lib/socket/types';
import type { RoundHistoryItem } from '@/components/GameOverModal';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type MultiplayerPhase =
  | 'WAITING_LOBBY'
  | 'PREPARING'
  | 'PLAYING'
  | 'ROUND_RESULT'
  | 'GAME_OVER'
  | 'ERROR';

interface HistorySnapshot {
  tiles: Tile[];
  poolTiles: Tile[];
  steps: Step[];
  selectedTile: Tile | null;
  selectedOp: Step['op'] | null;
}

interface RoundResultPayload {
  roundNumber: number;
  solvable: boolean;
  player1: { points: number; pointsRaw: number; outcome: 'win' | 'loss' | 'draw' };
  player2: { points: number; pointsRaw: number; outcome: 'win' | 'loss' | 'draw' };
  player1TotalRaw: number;
  player2TotalRaw: number;
}

interface MatchOverPayload {
  winnerId: string;
  player1TotalRaw: number;
  player2TotalRaw: number;
}

// --------------------------------------------------------------------------
// Tile reveal animation variants (copied from solo game)
// --------------------------------------------------------------------------

const tileVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.15, type: 'spring' as const, stiffness: 260, damping: 20 },
  }),
};

// --------------------------------------------------------------------------
// Inner game board (rendered inside AutoGameSocketProvider)
// --------------------------------------------------------------------------

function MatchBoard({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { isConnected, isReconnecting, emit, submitAnswer, emitThinking } = useGameSocket();

  // ── Auth ────────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
    });
  }, [router]);

  // ── Refs (no re-render on change) ───────────────────────────────────────

  /** Derived from opponent_joined; never changes mid-match. */
  const mySlotRef = useRef<PlayerSlot | null>(null);

  /**
   * Gate for auto-submit: reset to false on every round_start,
   * set to true the moment the auto-submit emit fires.
   */
  const hasAutoSubmitted = useRef(false);

  /**
   * Reconnect attempt counter for the ReconnectBanner.
   * Stored as ref so the banner text updates without a state re-render loop.
   */
  const reconnectAttemptRef = useRef(0);

  /** The matchId from URL params — kept in a ref for reconnect re-join. */
  const matchIdRef = useRef(matchId);

  // ── Phase & modal state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<MultiplayerPhase>('WAITING_LOBBY');
  const [waitingPhase, setWaitingPhase] = useState<WaitingPhase>('waiting');
  const [errorConfig, setErrorConfig] = useState<ErrorModalConfig | null>(null);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // ── Round state ─────────────────────────────────────────────────────────
  const [target, setTarget] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [poolTiles, setPoolTiles] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedOp, setSelectedOp] = useState<Step['op'] | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [roundNumber, setRoundNumber] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [prepCountdown, setPrepCountdown] = useState(5);

  // ── Scores ──────────────────────────────────────────────────────────────
  const [myTotalRaw, setMyTotalRaw] = useState(0);
  const [opponentTotalRaw, setOpponentTotalRaw] = useState(0);
  const [opponentStatus, setOpponentStatus] = useState<'thinking' | 'submitted' | null>(null);

  // ── Round result for modal ───────────────────────────────────────────────
  const [lastRoundResult, setLastRoundResult] = useState<RoundResultPayload | null>(null);

  // ── Match over for GameOverModal ─────────────────────────────────────────
  const [matchOverData, setMatchOverData] = useState<MatchOverPayload | null>(null);
  const [gameOverHistory, setGameOverHistory] = useState<RoundHistoryItem[]>([]);
  const matchStartRef = useRef<number>(Date.now());

  // ── Timer ────────────────────────────────────────────────────────────────
  const [timer, timerControls] = useRoundTimer();

  // ── Notification toast ───────────────────────────────────────────────────
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showNote = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  // --------------------------------------------------------------------------
  // join_room — emitted once when all three prerequisites are ready,
  // and again after every reconnect (handled by useJoinRoom's isConnected dep)
  // --------------------------------------------------------------------------
  useJoinRoom(matchId, !!userId && isConnected);

  // --------------------------------------------------------------------------
  // Workspace helpers (copied from solo game, adapted for multiplayer)
  // --------------------------------------------------------------------------

  function pushHistory(
    t: Tile[], p: Tile[], s: Step[],
    selTile: Tile | null, selOp: Step['op'] | null
  ) {
    setHistory(prev => [...prev, { tiles: t, poolTiles: p, steps: s, selectedTile: selTile, selectedOp: selOp }]);
  }

  function resetWorkspace(newTiles: Tile[]) {
    setTiles(newTiles);
    setPoolTiles([]);
    setSelectedTile(null);
    setSelectedOp(null);
    setSteps([]);
    setHistory([{
      tiles: newTiles, poolTiles: [], steps: [],
      selectedTile: null, selectedOp: null,
    }]);
  }

  function handleTileClick(tile: Tile) {
    if (phase !== 'PLAYING' || tile.used) return;

    // First tile selection: emit 'thinking' so opponent sees the badge.
    // (spec §6.1 — only 'thinking', never 'submitted' manually)
    if (!selectedTile) {
      const next = { ...tile, selected: true };
      const nextTiles = tiles.map(t => t.id === tile.id ? next : t);
      const nextPool = poolTiles.map(t => t.id === tile.id ? next : t);
      setSelectedTile(next);
      if (tile.isGenerated) setPoolTiles(nextPool); else setTiles(nextTiles);
      pushHistory(nextTiles, nextPool, steps, next, selectedOp);
      emitThinking();
      return;
    }

    // Deselect same tile
    if (selectedTile.id === tile.id) {
      const next = { ...tile, selected: false };
      const nextTiles = tiles.map(t => t.id === tile.id ? next : t);
      const nextPool = poolTiles.map(t => t.id === tile.id ? next : t);
      setSelectedTile(null);
      if (tile.isGenerated) setPoolTiles(nextPool); else setTiles(nextTiles);
      pushHistory(nextTiles, nextPool, steps, null, selectedOp);
      return;
    }

    // Swap selection if no op chosen
    if (!selectedOp) {
      const prev = { ...selectedTile, selected: false };
      let nextTiles = tiles.map(t => t.id === selectedTile.id ? prev : t);
      let nextPool = poolTiles.map(t => t.id === selectedTile.id ? prev : t);
      const next = { ...tile, selected: true };
      nextTiles = nextTiles.map(t => t.id === tile.id ? next : t);
      nextPool = nextPool.map(t => t.id === tile.id ? next : t);
      setSelectedTile(next);
      setTiles(nextTiles);
      setPoolTiles(nextPool);
      pushHistory(nextTiles, nextPool, steps, next, null);
      return;
    }

    // Execute the operation
    const result = applyOp(selectedTile.value, selectedOp, tile.value);
    if (result === null) {
      // Spec §5.2: show error toast, keep selection — do NOT deselect
      const msg =
        selectedOp === '\u2212' ? 'Subtraction must produce a positive number.' :
        selectedOp === '\u00F7' ? 'Division must be exact (no fractions).' :
        'Invalid operation!';
      showNote(msg, 'error');
      return;
    }

    const nextStep: Step = { a: selectedTile.value, op: selectedOp, b: tile.value, result };
    const nextSteps = [...steps, nextStep];
    const markUsed = (l: Tile[]) => l.map(t =>
      t.id === selectedTile.id || t.id === tile.id ? { ...t, used: true, selected: false } : t
    );
    const nextTiles = markUsed(tiles);
    const newGenTile: Tile = {
      id: `p_${Date.now()}`, value: result,
      used: false, selected: false, isGenerated: true,
    };
    const nextPool = [...markUsed(poolTiles), newGenTile];

    setSteps(nextSteps);
    setTiles(nextTiles);
    setPoolTiles(nextPool);
    setSelectedTile(null);
    setSelectedOp(null);
    pushHistory(nextTiles, nextPool, nextSteps, null, null);

    if (result === target) showNote('\uD83C\uDFAF Exact match!', 'success');
  }

  function handleOp(op: Step['op']) {
    if (phase !== 'PLAYING' || !selectedTile) return;
    const next = selectedOp === op ? null : op;
    setSelectedOp(next);
    pushHistory(tiles, poolTiles, steps, selectedTile, next);
  }

  function handleUndo() {
    if (history.length <= 1) return;
    const newHist = history.slice(0, -1);
    const prev = newHist[newHist.length - 1];
    setTiles(prev.tiles);
    setPoolTiles(prev.poolTiles);
    setSteps(prev.steps);
    setSelectedTile(prev.selectedTile);
    setSelectedOp(prev.selectedOp);
    setHistory(newHist);
  }

  function handleClear() {
    if (!history.length) return;
    const s0 = history[0];
    setTiles(s0.tiles);
    setPoolTiles(s0.poolTiles);
    setSteps(s0.steps);
    setSelectedTile(s0.selectedTile);
    setSelectedOp(s0.selectedOp);
    setHistory([s0]);
  }

  function handleSubmit() {
    if (phase !== 'PLAYING') return;
    if (isReconnecting) {
      showNote('Connection lost — cannot submit now.', 'error');
      return;
    }
    // Mark submitted before emitting to prevent auto-submit race
    hasAutoSubmitted.current = true;
    const sent = submitAnswer(steps);
    if (!sent) showNote('Connection lost — cannot submit now.', 'error');
  }

  // --------------------------------------------------------------------------
  // Auto-submit on timer expiry (RULE 4 — exactly once per round)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (!timer.isExpired) return;
    if (hasAutoSubmitted.current) return;

    hasAutoSubmitted.current = true;
    submitAnswer(steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.isExpired, phase]); // steps intentionally excluded — captured at expiry

  // --------------------------------------------------------------------------
  // Freeze/unfreeze timer when reconnecting
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (isReconnecting) {
      timerControls.freeze();
    } else {
      timerControls.unfreeze();
    }
  }, [isReconnecting, timerControls]);

  // --------------------------------------------------------------------------
  // PREPARING phase: 5-second countdown before PLAYING
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'PREPARING') return;
    if (prepCountdown <= 0) {
      setPhase('PLAYING');
      return;
    }
    const t = setTimeout(() => setPrepCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, prepCountdown]);

  // --------------------------------------------------------------------------
  // REVEALING: stagger tile reveal before PREPARING
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'PREPARING' || revealedCount >= tiles.length) return;
    const t = setTimeout(() => setRevealedCount(c => c + 1), 150);
    return () => clearTimeout(t);
  }, [phase, revealedCount, tiles.length]);

  // --------------------------------------------------------------------------
  // Socket event handlers — ALL use useSocketEvent for guaranteed cleanup
  // --------------------------------------------------------------------------

  // §2.1 Waiting for opponent
  const handleWaitingForOpponent = useCallback(() => {
    setPhase('WAITING_LOBBY');
    setWaitingPhase('waiting');
  }, []);
  useSocketEvent('waiting_for_opponent', handleWaitingForOpponent);

  // §2.2 Opponent joined — derive mySlot, transition to PREPARING
  const handleOpponentJoined = useCallback((payload: { player1Id: string; player2Id: string }) => {
    if (!userId) return;

    // RULE 9: store in ref synchronously before any state update
    mySlotRef.current = userId === payload.player1Id ? 'player1' : 'player2';

    // §2.2 flash toast
    showNote('Opponent joined! Get ready…', 'success');
    setWaitingPhase('opponent_joined');

    // Transition to PREPARING immediately (spec §2.1 State Reset)
    setTimeout(() => {
      setPhase('PREPARING');
      matchStartRef.current = Date.now();
    }, 800);
  }, [userId, showNote]);
  useSocketEvent('opponent_joined', handleOpponentJoined);

  // §round_start — THE reset point for every round (RULE 5)
  const handleRoundStart = useCallback((payload: {
    roundNumber: number; tiles: Tile[]; target: number;
    startTimestamp: number; durationMs: number;
  }) => {
    // RULE 5: reset auto-submit guard and all workspace state
    hasAutoSubmitted.current = false;

    setRoundNumber(payload.roundNumber);
    setTarget(payload.target);
    setRevealedCount(0);
    setOpponentStatus('thinking');
    resetWorkspace(payload.tiles);

    // RULE 3: timer derived strictly from server timestamps
    timerControls.start(payload.startTimestamp, payload.durationMs);

    // If coming from ROUND_RESULT, transition to PREPARING reveal first
    setPrepCountdown(5);
    setPhase('PREPARING');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerControls]); // resetWorkspace is local — safe
  useSocketEvent('round_start', handleRoundStart);

  // §6.1 Player status badge
  const handlePlayerStatus = useCallback((payload: { userId: string; status: 'thinking' | 'submitted' }) => {
    // This event is from the opponent (server only sends it to the other player)
    setOpponentStatus(payload.status);
  }, []);
  useSocketEvent('player_status', handlePlayerStatus);

  // §5.1 Round result
  const handleRoundResult = useCallback((payload: RoundResultPayload) => {
    timerControls.reset();
    setLastRoundResult(payload);

    const mySlot = mySlotRef.current;
    const myData = mySlot ? payload[mySlot] : payload.player1;
    const oppData = mySlot === 'player1' ? payload.player2 : payload.player1;

    setMyTotalRaw(mySlot === 'player1' ? payload.player1TotalRaw : payload.player2TotalRaw);
    setOpponentTotalRaw(mySlot === 'player1' ? payload.player2TotalRaw : payload.player1TotalRaw);

    // Accumulate for GameOverModal history
    setGameOverHistory(prev => [...prev, {
      round: payload.roundNumber,
      target,
      playerResult: null,   // TODO: track last step result per round if needed
      opponentResult: null,
      playerPoints: myData.points,
      opponentPoints: oppData.points,
      winner: myData.outcome === 'win' ? 'player' : myData.outcome === 'loss' ? 'opponent' : 'draw',
    }]);

    // RULE 8: stay in ROUND_RESULT until server sends round_start or match_over
    setPhase('ROUND_RESULT');
  }, [target, timerControls]);
  useSocketEvent('round_result', handleRoundResult);

  // §3.2 Match over — standard completion only (RULE 7)
  const handleMatchOver = useCallback((payload: MatchOverPayload) => {
    setMatchOverData(payload);
    setPhase('GAME_OVER');
  }, []);
  useSocketEvent('match_over', handleMatchOver);

  // §3.1 Opponent left — self-sufficient (RULE 6/7, no match_over follows)
  const handleOpponentLeft = useCallback(() => {
    timerControls.freeze();
    setPhase('WAITING_LOBBY');
    setWaitingPhase('opponent_left');
  }, [timerControls]);
  useSocketEvent('opponent_left', handleOpponentLeft);

  // §1.x / §5.3 Server errors
  const handleError = useCallback((payload: { code: string; message: string }) => {
    const code = payload.code as ServerErrorCode;
    // Submission errors (§5.3) are toasts — do not break phase
    if (code === 'not_in_room' || code === 'no_active_round' || code === 'not_a_player') {
      showNote(`Submit failed: ${payload.message}`, 'error');
      console.error('[match] server error:', payload);
      return;
    }
    // Room-entry errors (§1.x) → modal
    setErrorConfig(ERROR_CONFIGS[code] ?? ERROR_CONFIGS.generic);
    setPhase('ERROR');
  }, [showNote]);
  useSocketEvent('error', handleError);

  // §4.2 Reconnect attempt counter
  const handleReconnectAttempt = useCallback((attempt: number) => {
    reconnectAttemptRef.current = attempt;
    setReconnectAttempt(attempt);
  }, []);

  // §4.3 Reconnect failed
  const handleReconnectFailed = useCallback(() => {
    setReconnectFailed(true);
    setPhase('ERROR');
  }, []);

  // §4.2 / §4.3 — socket.io manager events (reconnect_attempt, reconnect_failed)
  // These fire on socket.io (the Manager), not on the socket itself.
  // We access the socket from context directly via useGameSocketContext().
  const { socket: rawSocket } = useGameSocketContext();

  useEffect(() => {
    const manager = rawSocket.io;

    const onAttempt = (attempt: number) => {
      reconnectAttemptRef.current = attempt;
      setReconnectAttempt(attempt);
    };

    const onFailed = () => {
      setReconnectFailed(true);
      setPhase('ERROR');
    };

    manager.on('reconnect_attempt', onAttempt);
    manager.on('reconnect_failed', onFailed);

    return () => {
      manager.off('reconnect_attempt', onAttempt);
      manager.off('reconnect_failed', onFailed);
    };
  }, [rawSocket]);

  // --------------------------------------------------------------------------
  // Timer-expiry visual indicator
  // --------------------------------------------------------------------------
  const timerPct = timer.pct;
  const secondsLeft = timer.secondsLeft;
  const timerColour =
    secondsLeft > 10 ? 'bg-primary-container' :
    secondsLeft > 5  ? 'bg-secondary'         : 'bg-error';

  // --------------------------------------------------------------------------
  // Derived: my slot labels
  // --------------------------------------------------------------------------
  const isPlayer1 = mySlotRef.current === 'player1';
  const myRoundResult = lastRoundResult
    ? (isPlayer1 ? lastRoundResult.player1 : lastRoundResult.player2)
    : null;
  const oppRoundResult = lastRoundResult
    ? (isPlayer1 ? lastRoundResult.player2 : lastRoundResult.player1)
    : null;

  const myFinalScore = myTotalRaw / 100;
  const oppFinalScore = opponentTotalRaw / 100;

  // --------------------------------------------------------------------------
  // Computed winner for GameOverModal
  // --------------------------------------------------------------------------
  const gameOverWinner: 'player' | 'opponent' | 'draw' = (() => {
    if (!matchOverData || !mySlotRef.current) return 'draw';
    const myId = userId;
    if (matchOverData.winnerId === myId) return 'player';
    if (myTotalRaw === opponentTotalRaw) return 'draw';
    return 'opponent';
  })();

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md">
      <Navbar />

      {/* ── Toast notification ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg font-bold text-sm tracking-wider shadow-lg ${
              notification.type === 'success'
                ? 'bg-primary-container text-on-primary-container border border-primary-fixed-dim shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : notification.type === 'info'
                ? 'bg-surface-container-high text-on-surface border border-outline-variant'
                : 'bg-error-container text-on-error-container border border-error'
            }`}
          >
            {notification.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── §4.1/4.2/4.3 Reconnect banner + controls lockout ──────────────── */}
      <ReconnectBanner
        isReconnecting={isReconnecting}
        attemptNumber={reconnectAttempt}
        failed={reconnectFailed}
      />

      {/* ── §1.x / §4.3 Error modal ───────────────────────────────────────── */}
      <ErrorModal
        config={reconnectFailed ? ERROR_CONFIGS.reconnect_failed : errorConfig}
        onClose={() => { setErrorConfig(null); setReconnectFailed(false); }}
      />

      {/* ── §2.1 / §3.1 Waiting lobby / opponent left modal ──────────────── */}
      <WaitingLobby
        phase={waitingPhase}
        matchUrl={typeof window !== 'undefined' ? window.location.href : ''}
      />

      {/* ── PREPARING overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'PREPARING' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none"
          >
            <motion.p
              initial={{ scale: 0.5 }} animate={{ scale: 1 }}
              className="text-on-surface-variant font-bold tracking-[0.4em] text-lg mb-4 uppercase"
            >
              Prepare
            </motion.p>
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

      {/* ── §5.1 Round Result modal ───────────────────────────────────────── */}
      {lastRoundResult && myRoundResult && oppRoundResult && (
        <RoundResultModal
          isOpen={phase === 'ROUND_RESULT'}
          roundNumber={lastRoundResult.roundNumber}
          target={target}
          outcome={myRoundResult.outcome}
          player={{
            name: 'You',
            result: null,
            diff: null,
            timeMs: null,
            steps: steps,
            pointsEarned: myRoundResult.points,
            pointsRaw: myRoundResult.pointsRaw,
            totalPoints: myFinalScore,
          }}
          opponent={{
            name: 'Opponent',
            result: null,
            diff: null,
            timeMs: null,
            steps: [],
            pointsEarned: oppRoundResult.points,
            pointsRaw: oppRoundResult.pointsRaw,
            totalPoints: oppFinalScore,
          }}
          solvability={{ solvable: lastRoundResult.solvable }}
          // RULE 8: onNextRound is a no-op — server drives the transition via round_start
          onNextRound={() => {}}
          onClose={() => {}}
        />
      )}

      {/* ── §3.2 Game Over modal ──────────────────────────────────────────── */}
      <GameOverModal
        isOpen={phase === 'GAME_OVER'}
        winner={gameOverWinner}
        playerFinalScore={myFinalScore}
        opponentFinalScore={oppFinalScore}
        roundsHistory={gameOverHistory}
        mmrStats={{ previousMmr: 0, delta: 0, currentMmr: 0 }}
        matchDurationSeconds={Math.floor((Date.now() - matchStartRef.current) / 1000)}
        onReturnToLobby={() => {
          destroySocket();
          router.push('/lobby');
        }}
        onPlayAgain={() => {
          destroySocket();
          router.push('/lobby');
        }}
      />

      {/* ── Main game board ───────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col w-full max-w-[900px] mx-auto px-4 py-6 gap-4">

        {/* Score row */}
        <div className="grid grid-cols-2 gap-3">
          {/* My score */}
          <div className="glass-panel rounded-xl p-4 flex flex-col gap-1">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">
              You
            </span>
            <span className="font-mono text-on-surface font-bold text-lg">
              {(myTotalRaw / 100).toFixed(2)} pts
            </span>
          </div>
          {/* Opponent score + status badge */}
          <div className="glass-panel rounded-xl p-4">
            <OpponentScoreHeader
              label="Opponent"
              totalRaw={opponentTotalRaw}
              status={opponentStatus}
            />
          </div>
        </div>

        {/* Target + Timer bar */}
        <div className="glass-panel rounded-xl p-6 flex flex-col items-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.06),transparent)] pointer-events-none" />
          <div className="flex w-full justify-between items-center mb-3">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">
              {roundNumber > 0 ? `Round ${roundNumber}` : 'Round'}
            </span>
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">timer</span>
              {phase === 'PLAYING' ? formatTimerDisplay(secondsLeft) : '--:--'}
              {timer.isFrozen && (
                <span className="text-error ml-1 text-[10px] animate-pulse">FROZEN</span>
              )}
            </span>
          </div>
          <div
            className={`text-7xl font-black text-primary-container tracking-tighter mb-4 transition-all duration-500 ${
              phase === 'WAITING_LOBBY' || phase === 'PREPARING' ? 'blur-xl opacity-50' : ''
            }`}
            style={{ textShadow: phase === 'PLAYING' ? '0 0 30px #00F0FF' : undefined }}
          >
            {target || '???'}
          </div>
          {/* Timer bar — spec §3.1: freeze visually via timer.isFrozen */}
          <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full shadow-[0_0_10px_currentColor] ${timerColour}`}
              animate={{ width: phase === 'PLAYING' ? `${timerPct}%` : phase === 'ROUND_RESULT' ? '0%' : '100%' }}
              transition={{ duration: 0.25, ease: 'linear' }}
            />
          </div>
        </div>

        {/* Calculation log */}
        <div className="glass-panel rounded-xl p-4 min-h-[100px] flex flex-col">
          <div className="text-on-surface-variant text-xs font-bold uppercase tracking-widest mb-3">
            Calculation Log
          </div>
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto max-h-40">
            {steps.length === 0 && !selectedTile && (
              <p className="text-on-surface-variant/40 text-sm italic">
                Select a tile and an operator to begin…
              </p>
            )}
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-mono w-12 text-right text-on-surface">{s.a}</span>
                <span className="text-primary-fixed-dim font-bold w-4 text-center">{s.op}</span>
                <span className="font-mono w-12 text-on-surface">{s.b}</span>
                <span className="text-on-surface-variant">=</span>
                <span className={`font-mono font-bold ${s.result === target ? 'text-primary' : 'text-on-surface'}`}>
                  {s.result}
                </span>
                {s.result === target && (
                  <span className="text-xs text-primary animate-pulse ml-1">✓ Target!</span>
                )}
              </div>
            ))}
            {selectedTile && (
              <div className="flex items-center gap-3 text-sm bg-surface-container/50 p-2 rounded-lg border border-primary-fixed-dim/30">
                <span className="font-mono w-12 text-right text-on-surface">{selectedTile.value}</span>
                {selectedOp
                  ? <><span className="text-primary-fixed-dim font-bold w-4 text-center">{selectedOp}</span>
                      <span className="w-12 h-6 border-b-2 border-primary-fixed-dim animate-pulse" /></>
                  : <span className="text-on-surface-variant/60 text-xs italic ml-2">← pick operator</span>
                }
              </div>
            )}
          </div>
        </div>

        {/* Controls panel — pointer-events-none applied by ReconnectBanner overlay */}
        <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">

          {/* Operator buttons */}
          <div className="flex justify-center gap-4">
            {(['+', '\u2212', '\u00D7', '\u00F7'] as const).map(op => (
              <button
                key={op}
                onClick={() => handleOp(op)}
                disabled={phase !== 'PLAYING' || !selectedTile || isReconnecting}
                className={`w-14 h-14 rounded-xl border font-bold text-xl transition-all disabled:opacity-30 disabled:pointer-events-none ${
                  selectedOp === op
                    ? 'bg-primary-container border-primary-fixed-dim text-on-primary-container shadow-[0_0_14px_rgba(0,240,255,0.5)]'
                    : 'bg-surface-variant/30 border-outline-variant hover:border-primary-fixed-dim hover:text-primary-fixed-dim'
                }`}
              >
                {op}
              </button>
            ))}
          </div>

          {/* Initial tiles — staggered reveal during PREPARING, all visible in PLAYING */}
          <div className="grid grid-cols-6 gap-3">
            {tiles.length === 0
              ? Array(6).fill(null).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-surface-container-high border border-outline-variant/20 opacity-30" />
                ))
              : tiles.map((tile, i) => {
                  const visible = i < revealedCount || phase === 'PLAYING' || phase === 'ROUND_RESULT';
                  const isSel = selectedTile?.id === tile.id;
                  return (
                    <motion.button
                      key={tile.id}
                      custom={i}
                      variants={tileVariants}
                      initial="hidden"
                      animate={visible ? 'visible' : 'hidden'}
                      onClick={() => handleTileClick(tile)}
                      disabled={phase !== 'PLAYING' || tile.used || isReconnecting}
                      className={`aspect-square rounded-xl border font-bold text-lg flex items-center justify-center transition-all ${
                        tile.used
                          ? 'opacity-25 cursor-not-allowed bg-surface-container-lowest border-outline-variant/10'
                          : isSel
                          ? 'border-primary bg-surface-container-highest shadow-[0_0_14px_rgba(0,240,255,0.6)] text-primary scale-105'
                          : 'bg-surface-container-high border-outline-variant/50 hover:border-primary hover:shadow-[0_0_8px_rgba(0,240,255,0.3)] hover:scale-105'
                      }`}
                    >
                      {tile.value}
                    </motion.button>
                  );
                })
            }
          </div>

          {/* Pool tiles (computed results) */}
          {poolTiles.filter(t => !t.used).length > 0 && (
            <div className="flex flex-wrap gap-3">
              {poolTiles.map(tile => {
                if (tile.used) return null;
                const isSel = selectedTile?.id === tile.id;
                return (
                  <motion.button
                    key={tile.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={() => handleTileClick(tile)}
                    disabled={phase !== 'PLAYING' || isReconnecting}
                    className={`px-5 py-2 rounded-xl border font-bold transition-all ${
                      isSel
                        ? 'border-primary bg-secondary-container/40 text-primary shadow-[0_0_14px_rgba(0,240,255,0.6)] scale-105'
                        : 'border-secondary/40 bg-secondary-container/20 text-secondary hover:bg-secondary-container/40 hover:scale-105'
                    }`}
                  >
                    {tile.value}
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* Action row */}
          <div className="flex gap-3">
            <button
              onClick={handleUndo}
              disabled={phase !== 'PLAYING' || history.length <= 1 || isReconnecting}
              className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface hover:bg-surface-variant transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span className="material-symbols-outlined text-[18px]">undo</span> Undo
            </button>

            {phase === 'PLAYING' && (
              <button
                onClick={handleClear}
                disabled={isReconnecting}
                className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface hover:bg-error-container hover:text-on-error-container hover:border-error transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined text-[18px]">restart_alt</span> Clear
              </button>
            )}

            <button
              onClick={handleSubmit}
              disabled={phase !== 'PLAYING' || isReconnecting || hasAutoSubmitted.current}
              className="flex-[2] py-3 rounded-xl bg-primary-container text-on-primary-container hover:bg-primary transition-all font-bold text-sm uppercase tracking-wider neon-glow flex justify-center items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
            >
              Submit <span className="material-symbols-outlined text-[18px]">check</span>
            </button>

            <button
              onClick={() => { destroySocket(); router.push('/lobby'); }}
              className="flex-1 py-3 rounded-xl border border-outline-variant text-on-surface-variant hover:text-error hover:border-error transition-colors font-bold text-sm uppercase tracking-wider flex justify-center items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page entry — wraps MatchBoard in AutoGameSocketProvider (fetches token)
// --------------------------------------------------------------------------

function MatchPageInner() {
  const params = useParams();
  const matchId = typeof params.matchId === 'string' ? params.matchId : '';

  if (!matchId) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-error font-mono text-sm">Invalid match ID.</p>
    </div>
  );

  return (
    <AutoGameSocketProvider>
      <MatchBoard matchId={matchId} />
    </AutoGameSocketProvider>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    }>
      <MatchPageInner />
    </Suspense>
  );
}
