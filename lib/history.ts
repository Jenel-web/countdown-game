import type { SupabaseClient } from '@supabase/supabase-js';
import { displayName } from '@/lib/auth/username';

/** The database stores points as integers: 100 = 1.00 point. */
export const POINTS_SCALE = 100;
/** A match normally ends when someone reaches 5 points. */
export const MATCH_TARGET_RAW = 5 * POINTS_SCALE;

export interface HistoryStep {
  a: number;
  op: string;
  b: number;
  result: number;
}

export interface MatchRow {
  id: string;
  player1_id: string;
  player2_id: string | null;
  player1_total_points: number | null;
  player2_total_points: number | null;
  winner_id: string | null;
  created_at: string | null;
  ended_at: string | null;
}

export interface RoundRow {
  match_id: string;
  round_number: number;
  target: number;
  tiles: unknown;
  player1_result: number | null;
  player2_result: number | null;
  player1_time_ms: number | null;
  player2_time_ms: number | null;
  player1_points: number | string | null;
  player2_points: number | string | null;
  player1_outcome: string | null;
  player2_outcome: string | null;
  player1_steps: HistoryStep[] | null;
  player2_steps: HistoryStep[] | null;
}

export interface ProfileLite {
  id: string;
  username: string | null;
  /** Never loaded for other players: email is private (docs/sql/2026-10-21-lockdown-c1.sql). */
  email?: string | null;
}

export interface MatchSummary {
  id: string;
  /** ended_at, or created_at for matches finished before ended_at existed. */
  endedAt: string | null;
  roundCount: number;
  /** You, always the left side. */
  me: { id: string; name: string; totalRaw: number };
  /** Your opponent, always the right side. */
  opponent: { id: string | null; name: string; totalRaw: number };
  didWin: boolean;
  forfeit: boolean;
}

export interface SideView {
  timeMs: number | null;
  pointsRaw: number;
  result: number | null;
  /** null = steps were not saved for this round (older matches). */
  steps: HistoryStep[] | null;
}

export type RoundWinner = 'me' | 'opponent' | 'draw';

export interface RoundView {
  roundNumber: number;
  target: number;
  tiles: number[];
  me: SideView;
  opponent: SideView;
  winner: RoundWinner;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when neither player reached 5 points, i.e. the match ended by disconnect. */
export function isForfeit(totalsRaw: [number, number]): boolean {
  return totalsRaw[0] < MATCH_TARGET_RAW && totalsRaw[1] < MATCH_TARGET_RAW;
}

/** Turns the stored tiles (objects with a `value`, or plain numbers) into numbers. */
export function tilesToValues(tiles: unknown): number[] {
  if (!Array.isArray(tiles)) return [];
  return tiles
    .map((t) => (typeof t === 'number' ? t : (t as { value?: unknown })?.value))
    .filter((v): v is number => typeof v === 'number');
}

/** Builds the list row for one finished match, with the logged-in player on the left. */
export function toMatchSummary(
  row: MatchRow,
  userId: string,
  profiles: Map<string, ProfileLite>,
  roundCount: number
): MatchSummary {
  const iAmPlayer1 = row.player1_id === userId;
  const opponentId = iAmPlayer1 ? row.player2_id : row.player1_id;
  const myRaw = (iAmPlayer1 ? row.player1_total_points : row.player2_total_points) ?? 0;
  const oppRaw = (iAmPlayer1 ? row.player2_total_points : row.player1_total_points) ?? 0;

  return {
    id: row.id,
    endedAt: row.ended_at ?? row.created_at,
    roundCount,
    me: { id: userId, name: displayName(profiles.get(userId), 'You'), totalRaw: myRaw },
    opponent: {
      id: opponentId,
      name: displayName(opponentId ? profiles.get(opponentId) : null, 'Opponent'),
      totalRaw: oppRaw,
    },
    didWin: row.winner_id === userId,
    forfeit: isForfeit([myRaw, oppRaw]),
  };
}

/** Flips a stored round so "me" is always the left side, whichever slot I played. */
export function toRoundView(row: RoundRow, iAmPlayer1: boolean): RoundView {
  const side = (n: 1 | 2): { view: SideView; outcome: string | null } => {
    const k = `player${n}` as 'player1' | 'player2';
    const result = row[`${k}_result`];
    const steps = row[`${k}_steps`];
    return {
      outcome: row[`${k}_outcome`],
      view: {
        timeMs: row[`${k}_time_ms`],
        pointsRaw: Number(row[`${k}_points`] ?? 0),
        result,
        // No answer means no steps to show; an answer without saved steps is an older round.
        steps: result === null ? [] : steps ?? null,
      },
    };
  };

  const mine = side(iAmPlayer1 ? 1 : 2);
  const theirs = side(iAmPlayer1 ? 2 : 1);

  let winner: RoundWinner = 'draw';
  if (mine.outcome === 'win') winner = 'me';
  else if (theirs.outcome === 'win') winner = 'opponent';

  return {
    roundNumber: row.round_number,
    target: row.target,
    tiles: tilesToValues(row.tiles),
    me: mine.view,
    opponent: theirs.view,
    winner,
  };
}

/** 12430 -> "12.43s"; null (no answer) -> "Timeout". */
export function formatSeconds(ms: number | null): string {
  return ms === null ? 'Timeout' : `${(ms / 1000).toFixed(2)}s`;
}

/** Round points: 100 -> "1.00". */
export function formatPoints(raw: number): string {
  return (raw / POINTS_SCALE).toFixed(2);
}

/** Match totals without trailing zeros: 500 -> "5", 350 -> "3.5". */
export function formatScore(raw: number): string {
  return String(Number((raw / POINTS_SCALE).toFixed(2)));
}

/** {a:25, op:'×', b:4, result:100} -> "25 × 4 = 100". */
export function formatStep(step: HistoryStep): string {
  return `${step.a} ${step.op} ${step.b} = ${step.result}`;
}

/** "Oct 13, 2026 · 21:40" in the viewer's local time. */
export function formatMatchDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The player's most recent finished matches, newest first. Pending rooms
 * (never played) and matches abandoned without a winner are excluded.
 */
export async function fetchRecentMatches(
  supabase: SupabaseClient,
  userId: string,
  limit = 10
): Promise<MatchSummary[]> {
  const { data: matches, error } = await supabase
    .from('matches')
    .select(
      'id, player1_id, player2_id, player1_total_points, player2_total_points, winner_id, created_at, ended_at'
    )
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .not('winner_id', 'is', null)
    .order('ended_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = (matches ?? []) as MatchRow[];
  if (rows.length === 0) return [];

  const profileIds = Array.from(
    new Set(rows.flatMap((r) => [r.player1_id, r.player2_id]).filter((id): id is string => !!id))
  );
  const matchIds = rows.map((r) => r.id);

  const [profilesRes, roundsRes] = await Promise.all([
    supabase.from('profiles').select('id, username').in('id', profileIds),
    supabase.from('rounds').select('match_id').in('match_id', matchIds),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (roundsRes.error) throw roundsRes.error;

  const profiles = new Map<string, ProfileLite>(
    ((profilesRes.data ?? []) as ProfileLite[]).map((p) => [p.id, p])
  );
  const roundCounts = new Map<string, number>();
  for (const r of (roundsRes.data ?? []) as { match_id: string }[]) {
    roundCounts.set(r.match_id, (roundCounts.get(r.match_id) ?? 0) + 1);
  }

  return rows.map((row) => toMatchSummary(row, userId, profiles, roundCounts.get(row.id) ?? 0));
}

/** All rounds of one match, in order, with the logged-in player on the left. */
export async function fetchMatchRounds(
  supabase: SupabaseClient,
  matchId: string,
  userId: string
): Promise<RoundView[]> {
  const [matchRes, roundsRes] = await Promise.all([
    supabase.from('matches').select('player1_id').eq('id', matchId).maybeSingle(),
    supabase
      .from('rounds')
      .select(
        'match_id, round_number, target, tiles, player1_result, player2_result, player1_time_ms, player2_time_ms, player1_points, player2_points, player1_outcome, player2_outcome, player1_steps, player2_steps'
      )
      .eq('match_id', matchId)
      .order('round_number', { ascending: true }),
  ]);
  if (matchRes.error) throw matchRes.error;
  if (roundsRes.error) throw roundsRes.error;

  const iAmPlayer1 = matchRes.data?.player1_id === userId;
  return ((roundsRes.data ?? []) as RoundRow[]).map((r) => toRoundView(r, iAmPlayer1));
}
