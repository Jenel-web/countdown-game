'use client';

/**
 * app/match/[matchId]/page.tsx  (v2 — 3-column HUD, round-result modal timing, MMR fetch)
 *
 * STATE MACHINE (updated):
 *
 *   WAITING_LOBBY ──► PREPARING ──► PLAYING ──► ROUND_RESULT (5 s modal)
 *        │                                           │
 *        │ (opponent_left)               after 5 s → PREPARING → PLAYING …
 *        ▼                              (match_over) ▼
 *   opponent_left modal                         GAME_OVER
 *
 * KEY CHANGES FROM v1:
 *  - round_start payload is BUFFERED in a ref. When round_result arrives the
 *    modal shows for MODAL_DISPLAY_MS (5 000). When the timer fires, we consume
 *    the buffered payload, call timerControls.start(), reset workspace, and
 *    transition to PREPARING. If round_start arrives before the timer fires, it
 *    just overwrites the buffer — no race condition possible.
 *  - After match_over, we re-fetch the local player's profile from Supabase to
 *    get the updated MMR and compute the delta for GameOverModal.
 *  - Layout is now a 3-column grid (lg): left player sidebar | centre workbench
 *    | right opponent sidebar. Collapses to single column on mobile.
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
import RoundResultModal from '@/components/RoundResultModal';
import GameOverModal from '@/components/GameOverModal';
import RematchModal, { RematchState } from '@/components/RematchModal';
import type {
  Tile,
  Step,
  PlayerSlot,
  ServerErrorCode,
} from '@/lib/socket/types';
import type { RoundHistoryItem, MMRStats } from '@/components/GameOverModal';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

/** How long the round-result modal is visible before auto-advancing. */
const MODAL_DISPLAY_MS = 5_000;

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

/** Shape we store for the pending round_start while the modal is showing. */
interface BufferedRoundStart {
  roundNumber: number;
  tiles: Tile[];
  target: number;
  startTimestamp: number;
  durationMs: number;
}

interface ProfileData {
  email: string | null;
  wins: number;
  losses: number;
  mmr: number;
}

// --------------------------------------------------------------------------
// Tile animation variants
// --------------------------------------------------------------------------

const tileVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.12, type: 'spring' as const, stiffness: 260, damping: 20 },
  }),
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function computeRankTier(mmr: number): { tier: string; nextTier: number } {
  if (mmr >= 2000) return { tier: 'Grandmaster', nextTier: 2500 };
  if (mmr >= 1600) return { tier: 'Master', nextTier: 2000 };
  if (mmr >= 1300) return { tier: 'Diamond', nextTier: 1600 };
  if (mmr >= 1000) return { tier: 'Platinum', nextTier: 1300 };
  if (mmr >= 700) return { tier: 'Gold', nextTier: 1000 };
  if (mmr >= 400) return { tier: 'Silver', nextTier: 700 };
  return { tier: 'Bronze', nextTier: 400 };
}

// --------------------------------------------------------------------------
// PlayerSidebar — Enlarged In-Match Profile HUD (~2/3 screen height)
// --------------------------------------------------------------------------

interface PlayerSidebarProps {
  label: string;
  email: string | null;
  wins: number;
  losses: number;
  mmr: number;
  totalRaw: number;
  status?: 'thinking' | 'submitted' | null;
  /** If true, renders this as the "you" side (cyan accent). */
  isSelf?: boolean;
}

function PlayerSidebar({ label, email, wins, losses, mmr, totalRaw, status, isSelf }: PlayerSidebarProps) {
  const displayName = email ? email.split('@')[0] : label;
  const initials = (email ?? label).slice(0, 2).toUpperCase();
  const accentBorder = isSelf ? 'border-[#00E5FF]/40' : 'border-[#2962FF]/40';
  const accentGlow = isSelf
    ? 'shadow-[0_0_25px_rgba(0,229,255,0.18)] hover:shadow-[0_0_35px_rgba(0,229,255,0.28)]'
    : 'shadow-[0_0_20px_rgba(41,98,255,0.15)] hover:shadow-[0_0_30px_rgba(41,98,255,0.25)]';
  const accentColor = isSelf ? 'text-[#00E5FF]' : 'text-[#82B1FF]';
  const badgeBg = isSelf ? 'bg-[#00E5FF]/10 text-[#00E5FF] border-[#00E5FF]/30' : 'bg-[#2962FF]/15 text-[#82B1FF] border-[#2962FF]/30';

  const totalMatches = wins + losses;
  const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;
  const currentPts = (totalRaw / 100).toFixed(2);
  const ptsProgress = Math.min(100, (totalRaw / 500) * 100);

  return (
    <div
      className={`glass-panel rounded-2xl p-6 flex flex-col justify-between items-center text-center border ${accentBorder} ${accentGlow} h-[66vh] min-h-[560px] max-h-[720px] w-full transition-all duration-300 relative overflow-hidden backdrop-blur-xl`}
    >
      {/* Background radial highlight */}
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-32 blur-3xl pointer-events-none ${
          isSelf ? 'bg-[#00E5FF]/10' : 'bg-[#2962FF]/15'
        }`}
      />

      {/* TOP SECTION: Identity & Avatar */}
      <div className="flex flex-col items-center w-full relative z-10">
        {/* Role badge */}
        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border mb-3 flex items-center gap-1.5 ${badgeBg}`}>
          <span className="material-symbols-outlined text-[13px]">
            {isSelf ? 'person' : 'swords'}
          </span>
          {isSelf ? 'Your Operative' : 'Rival Operative'}
        </div>

        {/* Scaled Avatar */}
        <div className="relative mb-3 group">
          <div
            className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center font-black text-3xl sm:text-4xl border-2 ${
              isSelf ? 'border-[#00E5FF] shadow-[0_0_20px_rgba(0,229,255,0.4)]' : 'border-[#2962FF] shadow-[0_0_20px_rgba(41,98,255,0.3)]'
            } bg-surface-container-high transition-transform duration-300 group-hover:scale-105`}
          >
            <span className={accentColor}>{initials}</span>
          </div>

          {/* Active pulse status dot */}
          <span className="absolute bottom-1 right-1 flex h-4 w-4">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSelf ? 'bg-[#00E5FF]' : 'bg-[#2962FF]'}`} />
            <span className={`relative inline-flex rounded-full h-4 w-4 border-2 border-background ${isSelf ? 'bg-[#00E5FF]' : 'bg-[#2962FF]'}`} />
          </span>
        </div>

        {/* Username */}
        <h3
          className="font-headline-lg-mobile text-base sm:text-lg font-black text-on-background tracking-tight max-w-[220px] truncate"
          title={email ?? label}
        >
          {displayName}
        </h3>
        <p className="text-on-surface-variant font-mono text-[11px] truncate max-w-[200px] mt-0.5 opacity-80">
          {email ?? label}
        </p>
      </div>

      {/* MIDDLE SECTION: MMR & Win/Loss Records */}
      <div className="w-full flex flex-col gap-3 py-3 border-y border-outline-variant/15 relative z-10">
        {/* MMR Display Card */}
        <div className="bg-surface-container-low/80 rounded-xl p-3 border border-outline-variant/20 flex flex-col items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] text-[#00E5FF]">trending_up</span>
            MMR Rating
          </span>
          <span className="font-mono text-2xl sm:text-3xl font-black text-on-surface mt-0.5 tracking-tight">
            {mmr}
          </span>
          <span className="text-[10px] font-semibold text-[#00E5FF] uppercase tracking-widest mt-0.5">
            {mmr >= 1600 ? 'Master' : mmr >= 1300 ? 'Diamond' : mmr >= 1000 ? 'Platinum' : mmr >= 700 ? 'Gold' : 'Silver'} Tier
          </span>
        </div>

        {/* Win / Loss Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Wins */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">emoji_events</span> Wins
            </span>
            <span className="font-mono font-black text-lg text-emerald-300 mt-0.5">
              {wins}
            </span>
          </div>

          {/* Losses */}
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-2 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase text-rose-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">cancel</span> Losses
            </span>
            <span className="font-mono font-black text-lg text-rose-300 mt-0.5">
              {losses}
            </span>
          </div>
        </div>

        {/* Win Rate meter */}
        <div className="flex flex-col gap-1 px-1">
          <div className="flex justify-between items-center text-[10px] text-on-surface-variant font-mono">
            <span>Win Rate</span>
            <span className="font-bold text-on-surface">{winRate}%</span>
          </div>
          <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-[#00E5FF] rounded-full transition-all duration-500"
              style={{ width: `${winRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: Live Match Score & Status */}
      <div className="w-full flex flex-col gap-2 relative z-10">
        {/* Match Points Card */}
        <div className={`w-full rounded-xl p-3 border ${accentBorder} bg-surface-container-low flex flex-col items-center`}>
          <div className="flex justify-between items-center w-full text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mb-1">
            <span>Match Score</span>
            <span className="font-mono text-primary-fixed-dim">Goal: 5.0 pts</span>
          </div>
          <div className={`font-mono font-black text-3xl ${isSelf ? 'text-[#00E5FF]' : 'text-on-surface'}`}>
            {currentPts}
          </div>
          {/* Progress bar towards 5.0 points */}
          <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isSelf ? 'bg-[#00E5FF]' : 'bg-[#2962FF]'}`}
              style={{ width: `${ptsProgress}%` }}
            />
          </div>
        </div>

        {/* Opponent live status indicator (or self indicator) */}
        {!isSelf ? (
          <div className="min-h-[28px] flex items-center justify-center">
            <AnimatePresence mode="wait">
              {status ? (
                <motion.div
                  key={status}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${
                    status === 'submitted'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-surface-container-highest border-outline-variant/30 text-on-surface-variant'
                  }`}
                >
                  {status === 'submitted' ? (
                    <>
                      <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                      <span>Answer Submitted</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed-dim opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-fixed-dim" />
                      </span>
                      <span>Thinking…</span>
                    </>
                  )}
                </motion.div>
              ) : (
                <span className="text-[11px] text-on-surface-variant/60 font-mono">In Combat</span>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="min-h-[28px] flex items-center justify-center text-[11px] text-primary-fixed-dim font-bold uppercase tracking-wider">
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">shield</span> Ready For Battle
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// MatchBoard
// --------------------------------------------------------------------------

function MatchBoard({ matchId }: { matchId: string }) {
  const router = useRouter();
  const {
    isConnected,
    isReconnecting,
    submitAnswer,
    emitThinking,
    requestRematch,
    respondRematch,
    cancelRoom,
  } = useGameSocket();

  // ── Rematch negotiation state ───────────────────────────────────────────
  const [rematchState, setRematchState] = useState<RematchState>(null);

  // ── Auth & my profile ───────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<ProfileData>({ email: null, wins: 0, losses: 0, mmr: 1000 });
  const myPrevMmrRef = useRef<number>(1000); // snapshot before match_over so we can compute delta

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      // Fetch profile for the HUD
      const { data } = await supabase
        .from('profiles')
        .select('email, wins, losses, mmr')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        const profile = { email: data.email ?? user.email ?? null, wins: data.wins ?? 0, losses: data.losses ?? 0, mmr: data.mmr ?? 1000 };
        setMyProfile(profile);
        myPrevMmrRef.current = profile.mmr;
      }
    });
  }, [router]);

  // ── Opponent profile (populated from opponent_joined then Supabase) ──────
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [opponentProfile, setOpponentProfile] = useState<ProfileData>({ email: null, wins: 0, losses: 0, mmr: 1000 });

  useEffect(() => {
    if (!opponentId) return;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('email, wins, losses, mmr')
      .eq('id', opponentId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOpponentProfile({ email: data.email ?? null, wins: data.wins ?? 0, losses: data.losses ?? 0, mmr: data.mmr ?? 1000 });
      });
  }, [opponentId]);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const mySlotRef = useRef<PlayerSlot | null>(null);
  const hasAutoSubmitted = useRef(false);
  const reconnectAttemptRef = useRef(0);
  /**
   * Buffer for the round_start payload that arrives WHILE the round-result
   * modal is still visible. Consumed when the 5-second display timer fires.
   */
  const pendingRoundStartRef = useRef<BufferedRoundStart | null>(null);
  /** Timer ID for the ROUND_RESULT → PREPARING transition. */
  const modalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchStartRef = useRef<number>(Date.now());

  // ── Phase ────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<MultiplayerPhase>('WAITING_LOBBY');
  const [waitingPhase, setWaitingPhase] = useState<WaitingPhase>('waiting');
  const [errorConfig, setErrorConfig] = useState<ErrorModalConfig | null>(null);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // ── Round state ───────────────────────────────────────────────────────────
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

  // ── Scores ────────────────────────────────────────────────────────────────
  const [myTotalRaw, setMyTotalRaw] = useState(0);
  const [opponentTotalRaw, setOpponentTotalRaw] = useState(0);
  const [opponentStatus, setOpponentStatus] = useState<'thinking' | 'submitted' | null>(null);

  // ── Round result ──────────────────────────────────────────────────────────
  const [lastRoundResult, setLastRoundResult] = useState<RoundResultPayload | null>(null);
  /** Seconds remaining on the modal countdown (cosmetic) */
  const [modalSecondsLeft, setModalSecondsLeft] = useState(MODAL_DISPLAY_MS / 1000);

  // ── Game over ─────────────────────────────────────────────────────────────
  const [gameOverHistory, setGameOverHistory] = useState<RoundHistoryItem[]>([]);
  const [mmrStats, setMmrStats] = useState<MMRStats>({ previousMmr: 1000, delta: 0, currentMmr: 1000 });

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timer, timerControls] = useRoundTimer();

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showNote = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  // ── join_room ─────────────────────────────────────────────────────────────
  useJoinRoom(matchId, !!userId && isConnected);

  // ── Workspace helpers ─────────────────────────────────────────────────────

  function pushHistory(t: Tile[], p: Tile[], s: Step[], selTile: Tile | null, selOp: Step['op'] | null) {
    setHistory(prev => [...prev, { tiles: t, poolTiles: p, steps: s, selectedTile: selTile, selectedOp: selOp }]);
  }

  function resetWorkspace(newTiles: Tile[]) {
    setTiles(newTiles);
    setPoolTiles([]);
    setSelectedTile(null);
    setSelectedOp(null);
    setSteps([]);
    setHistory([{ tiles: newTiles, poolTiles: [], steps: [], selectedTile: null, selectedOp: null }]);
  }

  // ── CORE: apply a buffered round_start after the modal timer fires ────────

  const applyBufferedRoundStart = useCallback(() => {
    const payload = pendingRoundStartRef.current;
    if (!payload) return;
    pendingRoundStartRef.current = null;

    hasAutoSubmitted.current = false;
    setRoundNumber(payload.roundNumber);
    setTarget(payload.target);
    setRevealedCount(0);
    setOpponentStatus('thinking');
    resetWorkspace(payload.tiles);
    timerControls.start(payload.startTimestamp, payload.durationMs);
    setPrepCountdown(5);
    setPhase('PREPARING');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerControls]);

  // ── Tile/op interaction ───────────────────────────────────────────────────

  function handleTileClick(tile: Tile) {
    if (phase !== 'PLAYING' || tile.used) return;

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

    if (selectedTile.id === tile.id) {
      const next = { ...tile, selected: false };
      const nextTiles = tiles.map(t => t.id === tile.id ? next : t);
      const nextPool = poolTiles.map(t => t.id === tile.id ? next : t);
      setSelectedTile(null);
      if (tile.isGenerated) setPoolTiles(nextPool); else setTiles(nextTiles);
      pushHistory(nextTiles, nextPool, steps, null, selectedOp);
      return;
    }

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

    const result = applyOp(selectedTile.value, selectedOp, tile.value);
    if (result === null) {
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
    const newGenTile: Tile = { id: `p_${Date.now()}`, value: result, used: false, selected: false, isGenerated: true };
    const nextPool = [...markUsed(poolTiles), newGenTile];

    setSteps(nextSteps);
    setTiles(nextTiles);
    setPoolTiles(nextPool);
    setSelectedTile(null);
    setSelectedOp(null);
    pushHistory(nextTiles, nextPool, nextSteps, null, null);

    if (result === target) showNote('🎯 Exact match!', 'success');
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
    if (isReconnecting) { showNote('Connection lost — cannot submit now.', 'error'); return; }
    hasAutoSubmitted.current = true;
    const sent = submitAnswer(steps);
    if (!sent) showNote('Connection lost — cannot submit now.', 'error');
  }

  // ── Auto-submit on expiry ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'PLAYING' || !timer.isExpired || hasAutoSubmitted.current) return;
    hasAutoSubmitted.current = true;
    submitAnswer(steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.isExpired, phase]);

  // ── Freeze/unfreeze on reconnect ─────────────────────────────────────────
  useEffect(() => {
    if (isReconnecting) timerControls.freeze(); else timerControls.unfreeze();
  }, [isReconnecting, timerControls]);

  // ── PREPARING countdown ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'PREPARING') return;
    if (prepCountdown <= 0) { setPhase('PLAYING'); return; }
    const t = setTimeout(() => setPrepCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, prepCountdown]);

  // ── Tile stagger reveal ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'PREPARING' || revealedCount >= tiles.length) return;
    const t = setTimeout(() => setRevealedCount(c => c + 1), 150);
    return () => clearTimeout(t);
  }, [phase, revealedCount, tiles.length]);

  // ── Modal countdown display ticker ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'ROUND_RESULT') return;
    setModalSecondsLeft(MODAL_DISPLAY_MS / 1000);
    const interval = setInterval(() => {
      setModalSecondsLeft(s => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ── Cleanup modal timer on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
    };
  }, []);

  // --------------------------------------------------------------------------
  // Socket event handlers
  // --------------------------------------------------------------------------

  const handleWaitingForOpponent = useCallback(() => {
    setPhase('WAITING_LOBBY');
    setWaitingPhase('waiting');
  }, []);
  useSocketEvent('waiting_for_opponent', handleWaitingForOpponent);

  const handleOpponentJoined = useCallback((payload: { player1Id: string; player2Id: string }) => {
    if (!userId) return;
    mySlotRef.current = userId === payload.player1Id ? 'player1' : 'player2';
    const oppId = userId === payload.player1Id ? payload.player2Id : payload.player1Id;
    setOpponentId(oppId);
    showNote('Opponent joined! Get ready…', 'success');
    setWaitingPhase('opponent_joined');
    setTimeout(() => {
      setPhase('PREPARING');
      matchStartRef.current = Date.now();
    }, 800);
  }, [userId, showNote]);
  useSocketEvent('opponent_joined', handleOpponentJoined);

  /**
   * round_start — BUFFERED while modal is showing, applied immediately otherwise.
   *
   * Flow:
   *   - If phase === 'ROUND_RESULT' → store payload in ref, let the modal timer
   *     call applyBufferedRoundStart() when it fires.
   *   - Otherwise (round 1, or reconnect) → apply immediately.
   */
  const handleRoundStart = useCallback((payload: BufferedRoundStart) => {
    // Always write to the buffer — this way both paths converge to one application point.
    pendingRoundStartRef.current = payload;

    if (phase === 'ROUND_RESULT') {
      // Modal is already showing and its timer is already running.
      // The payload will be consumed when that timer fires. Nothing else to do.
      return;
    }

    // Round 1 (or unexpected re-emit): apply immediately.
    applyBufferedRoundStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, applyBufferedRoundStart]);
  useSocketEvent('round_start', handleRoundStart);

  const handlePlayerStatus = useCallback((payload: { userId: string; status: 'thinking' | 'submitted' }) => {
    setOpponentStatus(payload.status);
  }, []);
  useSocketEvent('player_status', handlePlayerStatus);

  const handleRoundResult = useCallback((payload: RoundResultPayload) => {
    timerControls.reset();
    setLastRoundResult(payload);

    const mySlot = mySlotRef.current;
    const myData = mySlot ? payload[mySlot] : payload.player1;
    const oppData = mySlot === 'player1' ? payload.player2 : payload.player1;

    setMyTotalRaw(mySlot === 'player1' ? payload.player1TotalRaw : payload.player2TotalRaw);
    setOpponentTotalRaw(mySlot === 'player1' ? payload.player2TotalRaw : payload.player1TotalRaw);

    setGameOverHistory(prev => [...prev, {
      round: payload.roundNumber,
      target,
      playerResult: null,
      opponentResult: null,
      playerPoints: myData.points,
      opponentPoints: oppData.points,
      winner: myData.outcome === 'win' ? 'player' : myData.outcome === 'loss' ? 'opponent' : 'draw',
    }]);

    // Transition to ROUND_RESULT and start the 5-second display timer.
    setPhase('ROUND_RESULT');

    // Clear any existing timer (safety guard against double-fire).
    if (modalTimerRef.current) clearTimeout(modalTimerRef.current);

    modalTimerRef.current = setTimeout(() => {
      modalTimerRef.current = null;
      applyBufferedRoundStart();
    }, MODAL_DISPLAY_MS);
  }, [target, timerControls, applyBufferedRoundStart]);
  useSocketEvent('round_result', handleRoundResult);

  /**
   * match_over — fetch updated profile for MMR delta, compute tier milestone, then show GAME_OVER.
   */
  const handleMatchOver = useCallback(async (payload: MatchOverPayload) => {
    // Cancel the modal→next-round timer — game is over.
    if (modalTimerRef.current) { clearTimeout(modalTimerRef.current); modalTimerRef.current = null; }

    const isWinner = payload.winnerId === userId;
    const expectedDelta = isWinner ? 25 : -15;

    // Fetch fresh profile to get updated MMR (server's finish_match RPC + MMR update ran).
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('email, wins, losses, mmr')
          .eq('id', user.id)
          .maybeSingle();

        const prevMmr = myPrevMmrRef.current;
        let delta = expectedDelta;
        let finalMmr = Math.max(0, prevMmr + delta);

        if (data) {
          const newProfile = {
            email: data.email ?? null,
            wins: data.wins ?? 0,
            losses: data.losses ?? 0,
            mmr: data.mmr ?? 1000,
          };
          setMyProfile(newProfile);
          if (newProfile.mmr !== prevMmr) {
            delta = newProfile.mmr - prevMmr;
            finalMmr = newProfile.mmr;
          }
        }

        const tierInfo = computeRankTier(finalMmr);
        setMmrStats({
          previousMmr: prevMmr,
          delta,
          currentMmr: finalMmr,
          rankTier: tierInfo.tier,
          nextTierMmr: tierInfo.nextTier,
        });
      }
    } catch (e) {
      console.error('[match_over] failed to refresh profile', e);
      const prevMmr = myPrevMmrRef.current;
      const tierInfo = computeRankTier(Math.max(0, prevMmr + expectedDelta));
      setMmrStats({
        previousMmr: prevMmr,
        delta: expectedDelta,
        currentMmr: Math.max(0, prevMmr + expectedDelta),
        rankTier: tierInfo.tier,
        nextTierMmr: tierInfo.nextTier,
      });
    }

    setPhase('GAME_OVER');
    setLastMatchOver(payload);
  }, [userId]);
  useSocketEvent('match_over', handleMatchOver);

  // ── Rematch socket listeners ──────────────────────────────────────────────
  const handleRematchOffer = useCallback(() => {
    setRematchState('incoming_offer');
  }, []);
  useSocketEvent('rematch_offer', handleRematchOffer);

  const handleRematchAccepted = useCallback((payload: { newMatchId: string }) => {
    setRematchState('accepted');
    setTimeout(() => {
      destroySocket();
      router.push(`/match/${payload.newMatchId}`);
    }, 1200);
  }, [router]);
  useSocketEvent('rematch_accepted', handleRematchAccepted);

  const handleRematchDeclined = useCallback(() => {
    setRematchState('declined');
  }, []);
  useSocketEvent('rematch_declined', handleRematchDeclined);

  // Separate state for match_over payload (avoids closure issues in handleMatchOver)
  const [lastMatchOver, setLastMatchOver] = useState<MatchOverPayload | null>(null);

  const handleOpponentLeft = useCallback(() => {
    if (modalTimerRef.current) { clearTimeout(modalTimerRef.current); modalTimerRef.current = null; }
    timerControls.freeze();
    setPhase('WAITING_LOBBY');
    setWaitingPhase('opponent_left');
  }, [timerControls]);
  useSocketEvent('opponent_left', handleOpponentLeft);

  const handleError = useCallback((payload: { code: string; message: string }) => {
    const code = payload.code as ServerErrorCode;
    if (code === 'not_in_room' || code === 'no_active_round' || code === 'not_a_player') {
      showNote(`Submit failed: ${payload.message}`, 'error');
      return;
    }
    setErrorConfig(ERROR_CONFIGS[code] ?? ERROR_CONFIGS.generic);
    setPhase('ERROR');
  }, [showNote]);
  useSocketEvent('error', handleError);

  // ── socket.io manager events ──────────────────────────────────────────────
  const { socket: rawSocket } = useGameSocketContext();

  useEffect(() => {
    const manager = rawSocket.io;
    const onAttempt = (attempt: number) => { reconnectAttemptRef.current = attempt; setReconnectAttempt(attempt); };
    const onFailed = () => { setReconnectFailed(true); setPhase('ERROR'); };
    manager.on('reconnect_attempt', onAttempt);
    manager.on('reconnect_failed', onFailed);
    return () => { manager.off('reconnect_attempt', onAttempt); manager.off('reconnect_failed', onFailed); };
  }, [rawSocket]);

  // --------------------------------------------------------------------------
  // Derived values
  // --------------------------------------------------------------------------

  const timerPct = timer.pct;
  const secondsLeft = timer.secondsLeft;
  const timerColour = secondsLeft > 10 ? 'bg-primary-container' : secondsLeft > 5 ? 'bg-secondary' : 'bg-error';

  const isPlayer1 = mySlotRef.current === 'player1';
  const myRoundResult = lastRoundResult ? (isPlayer1 ? lastRoundResult.player1 : lastRoundResult.player2) : null;
  const oppRoundResult = lastRoundResult ? (isPlayer1 ? lastRoundResult.player2 : lastRoundResult.player1) : null;
  const myFinalScore = myTotalRaw / 100;
  const oppFinalScore = opponentTotalRaw / 100;

  const gameOverWinner: 'player' | 'opponent' | 'draw' = (() => {
    if (!lastMatchOver) return 'draw';
    if (lastMatchOver.winnerId === userId) return 'player';
    if (myTotalRaw === opponentTotalRaw) return 'draw';
    return 'opponent';
  })();

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md">
      <Navbar />

      {/* Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg font-bold text-sm tracking-wider shadow-lg ${
              notification.type === 'success' ? 'bg-primary-container text-on-primary-container border border-primary-fixed-dim shadow-[0_0_15px_rgba(0,240,255,0.4)]'
              : notification.type === 'info' ? 'bg-surface-container-high text-on-surface border border-outline-variant'
              : 'bg-error-container text-on-error-container border border-error'
            }`}
          >
            {notification.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reconnect banner + lockout */}
      <ReconnectBanner isReconnecting={isReconnecting} attemptNumber={reconnectAttempt} failed={reconnectFailed} />

      {/* Error modal */}
      <ErrorModal
        config={reconnectFailed ? ERROR_CONFIGS.reconnect_failed : errorConfig}
        onClose={() => { setErrorConfig(null); setReconnectFailed(false); }}
      />

      {/* Waiting lobby / opponent left */}
      <WaitingLobby
        phase={waitingPhase}
        matchUrl={typeof window !== 'undefined' ? window.location.href : ''}
        onCancel={() => {
          cancelRoom(matchId);
          destroySocket();
          router.push('/lobby');
        }}
      />

      {/* PREPARING overlay */}
      <AnimatePresence>
        {phase === 'PREPARING' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none"
          >
            <motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-on-surface-variant font-bold tracking-[0.4em] text-lg mb-4 uppercase">
              Prepare
            </motion.p>
            <motion.div
              key={prepCountdown}
              initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
              className="text-[8rem] font-black text-primary-fixed-dim leading-none"
              style={{ textShadow: '0 0 40px #00F0FF, 0 0 80px rgba(0,240,255,0.4)' }}
            >
              {prepCountdown}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round Result modal — isOpen driven by phase, auto-closes via modalTimer */}
      {lastRoundResult && myRoundResult && oppRoundResult && (
        <RoundResultModal
          isOpen={phase === 'ROUND_RESULT'}
          roundNumber={lastRoundResult.roundNumber}
          target={target}
          outcome={myRoundResult.outcome}
          player={{
            name: myProfile.email ?? 'You',
            result: null, diff: null, timeMs: null,
            steps: steps,
            pointsEarned: myRoundResult.points,
            pointsRaw: myRoundResult.pointsRaw,
            totalPoints: myFinalScore,
          }}
          opponent={{
            name: opponentProfile.email ?? 'Opponent',
            result: null, diff: null, timeMs: null,
            steps: [],
            pointsEarned: oppRoundResult.points,
            pointsRaw: oppRoundResult.pointsRaw,
            totalPoints: oppFinalScore,
          }}
          solvability={{ solvable: lastRoundResult.solvable }}
          countdownSeconds={modalSecondsLeft}
          // onNextRound is intentionally a no-op — the 5s timer drives the transition
          onNextRound={() => {}}
          onClose={() => {}}
        />
      )}

      {/* Game Over modal */}
      <GameOverModal
        isOpen={phase === 'GAME_OVER' && rematchState === null}
        winner={gameOverWinner}
        playerName={myProfile.email ? myProfile.email.split('@')[0] : 'You'}
        opponentName={opponentProfile.email ? opponentProfile.email.split('@')[0] : 'Opponent'}
        playerFinalScore={myFinalScore}
        opponentFinalScore={oppFinalScore}
        roundsHistory={gameOverHistory}
        mmrStats={mmrStats}
        matchDurationSeconds={Math.floor((Date.now() - matchStartRef.current) / 1000)}
        onReturnToLobby={() => { destroySocket(); router.push('/lobby'); }}
        onPlayAgain={() => {
          requestRematch(matchId);
          setRematchState('waiting_for_response');
        }}
      />

      {/* Rematch Modal */}
      <RematchModal
        state={rematchState}
        opponentName={opponentProfile.email ? opponentProfile.email.split('@')[0] : 'Opponent'}
        onAccept={() => {
          respondRematch(matchId, true);
          setRematchState('accepted');
        }}
        onDecline={() => {
          respondRematch(matchId, false);
          setRematchState(null);
        }}
        onCancelRequest={() => {
          setRematchState(null);
          destroySocket();
          router.push('/lobby');
        }}
        onReturnToLobby={() => {
          setRematchState(null);
          destroySocket();
          router.push('/lobby');
        }}
      />

      {/* ── Main layout — 3-column on lg, stacked on mobile ─────────────────── */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] xl:grid-cols-[300px_1fr_300px] gap-6 items-start">

        {/* LEFT SIDEBAR — My profile */}
        <aside className="hidden lg:flex flex-col gap-3 sticky top-20">
          <PlayerSidebar
            label="You"
            email={myProfile.email}
            wins={myProfile.wins}
            losses={myProfile.losses}
            mmr={myProfile.mmr}
            totalRaw={myTotalRaw}
            isSelf
          />
        </aside>

        {/* CENTRE COLUMN — Target / timer / workbench */}
        <div className="flex flex-col gap-3 min-w-0">

          {/* Mobile score bar (hidden on lg) */}
          <div className="flex lg:hidden gap-2">
            <div className="flex-1 glass-panel rounded-xl p-3 text-center">
              <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">You</div>
              <div className="font-mono font-black text-lg text-primary-fixed-dim">{myFinalScore.toFixed(2)}</div>
            </div>
            <div className="flex-1 glass-panel rounded-xl p-3 text-center">
              <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Opponent</div>
              <div className="font-mono font-black text-lg text-on-surface">{oppFinalScore.toFixed(2)}</div>
              {opponentStatus && (
                <div className={`text-[9px] font-bold uppercase mt-1 ${opponentStatus === 'submitted' ? 'text-primary-fixed-dim' : 'text-on-surface-variant'}`}>
                  {opponentStatus}
                </div>
              )}
            </div>
          </div>

          {/* Target + timer bar */}
          <div className="glass-panel rounded-xl p-5 flex flex-col items-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.05),transparent)] pointer-events-none" />
            <div className="flex w-full justify-between items-center mb-2">
              <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">
                {roundNumber > 0 ? `Round ${roundNumber}` : 'Round'}
              </span>
              <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">timer</span>
                {phase === 'PLAYING' ? formatTimerDisplay(secondsLeft) : '--:--'}
                {timer.isFrozen && <span className="text-error ml-1 text-[9px] animate-pulse">FROZEN</span>}
              </span>
            </div>
            <div
              className={`text-6xl font-black text-primary-container tracking-tighter mb-3 transition-all duration-500 ${
                phase === 'WAITING_LOBBY' || phase === 'PREPARING' ? 'blur-xl opacity-50' : ''
              }`}
              style={{ textShadow: phase === 'PLAYING' ? '0 0 24px #00F0FF' : undefined }}
            >
              {target || '???'}
            </div>
            <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${timerColour}`}
                animate={{ width: phase === 'PLAYING' ? `${timerPct}%` : phase === 'ROUND_RESULT' ? '0%' : '100%' }}
                transition={{ duration: 0.25, ease: 'linear' }}
              />
            </div>
          </div>

          {/* Calculation log */}
          <div className="glass-panel rounded-xl p-4 min-h-[90px] flex flex-col">
            <div className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest mb-2">Calculation Log</div>
            <div className="flex flex-col gap-2 flex-1 overflow-y-auto max-h-36">
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
                    : <span className="text-on-surface-variant/60 text-xs italic ml-2">← pick operator</span>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Controls panel */}
          <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
            {/* Operators */}
            <div className="flex justify-center gap-3">
              {(['+', '\u2212', '\u00D7', '\u00F7'] as const).map(op => (
                <button
                  key={op}
                  onClick={() => handleOp(op)}
                  disabled={phase !== 'PLAYING' || !selectedTile || isReconnecting}
                  className={`w-13 h-13 w-12 h-12 rounded-xl border font-bold text-xl transition-all disabled:opacity-30 disabled:pointer-events-none ${
                    selectedOp === op
                      ? 'bg-primary-container border-primary-fixed-dim text-on-primary-container shadow-[0_0_14px_rgba(0,240,255,0.5)]'
                      : 'bg-surface-variant/30 border-outline-variant hover:border-primary-fixed-dim hover:text-primary-fixed-dim'
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>

            {/* Initial tiles */}
            <div className="grid grid-cols-6 gap-2">
              {tiles.length === 0
                ? Array(6).fill(null).map((_, i) => (
                    <div key={i} className="aspect-square rounded-xl bg-surface-container-high border border-outline-variant/20 opacity-30" />
                  ))
                : tiles.map((tile, i) => {
                    const visible = i < revealedCount || phase === 'PLAYING' || phase === 'ROUND_RESULT';
                    const isSel = selectedTile?.id === tile.id;
                    return (
                      <motion.button
                        key={tile.id} custom={i} variants={tileVariants} initial="hidden" animate={visible ? 'visible' : 'hidden'}
                        onClick={() => handleTileClick(tile)}
                        disabled={phase !== 'PLAYING' || tile.used || isReconnecting}
                        className={`aspect-square rounded-xl border font-bold text-base flex items-center justify-center transition-all ${
                          tile.used ? 'opacity-25 cursor-not-allowed bg-surface-container-lowest border-outline-variant/10'
                          : isSel ? 'border-primary bg-surface-container-highest shadow-[0_0_14px_rgba(0,240,255,0.6)] text-primary scale-105'
                          : 'bg-surface-container-high border-outline-variant/50 hover:border-primary hover:shadow-[0_0_8px_rgba(0,240,255,0.3)] hover:scale-105'
                        }`}
                      >
                        {tile.value}
                      </motion.button>
                    );
                  })
              }
            </div>

            {/* Pool tiles */}
            {poolTiles.filter(t => !t.used).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {poolTiles.map(tile => {
                  if (tile.used) return null;
                  const isSel = selectedTile?.id === tile.id;
                  return (
                    <motion.button
                      key={tile.id} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      onClick={() => handleTileClick(tile)} disabled={phase !== 'PLAYING' || isReconnecting}
                      className={`px-4 py-2 rounded-xl border font-bold transition-all ${
                        isSel ? 'border-primary bg-secondary-container/40 text-primary shadow-[0_0_14px_rgba(0,240,255,0.6)] scale-105'
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
            <div className="flex gap-2">
              <button
                onClick={handleUndo}
                disabled={phase !== 'PLAYING' || history.length <= 1 || isReconnecting}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant text-on-surface hover:bg-surface-variant transition-colors font-bold text-xs uppercase tracking-wider flex justify-center items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined text-[16px]">undo</span> Undo
              </button>
              {phase === 'PLAYING' && (
                <button
                  onClick={handleClear} disabled={isReconnecting}
                  className="flex-1 py-2.5 rounded-xl border border-outline-variant text-on-surface hover:bg-error-container hover:text-on-error-container hover:border-error transition-colors font-bold text-xs uppercase tracking-wider flex justify-center items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span> Clear
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={phase !== 'PLAYING' || isReconnecting || hasAutoSubmitted.current}
                className="flex-[2] py-2.5 rounded-xl bg-primary-container text-on-primary-container hover:bg-primary transition-all font-bold text-xs uppercase tracking-wider neon-glow flex justify-center items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
              >
                Submit <span className="material-symbols-outlined text-[16px]">check</span>
              </button>
              <button
                onClick={() => { destroySocket(); router.push('/lobby'); }}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant text-on-surface-variant hover:text-error hover:border-error transition-colors font-bold text-xs uppercase tracking-wider flex justify-center items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR — Opponent profile */}
        <aside className="hidden lg:flex flex-col gap-3 sticky top-20">
          <PlayerSidebar
            label="Opponent"
            email={opponentProfile.email}
            wins={opponentProfile.wins}
            losses={opponentProfile.losses}
            mmr={opponentProfile.mmr}
            totalRaw={opponentTotalRaw}
            status={opponentStatus}
          />
        </aside>
      </main>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page entry
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
