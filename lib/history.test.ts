import { describe, it, expect } from 'vitest';
import {
  formatMatchDate,
  formatPoints,
  formatScore,
  formatSeconds,
  formatStep,
  isForfeit,
  tilesToValues,
  toMatchSummary,
  toRoundView,
  type MatchRow,
  type ProfileLite,
  type RoundRow,
} from './history';

const profiles = new Map<string, ProfileLite>([
  ['me', { id: 'me', username: 'Jenel_29', email: 'x@gmail.com' }],
  ['them', { id: 'them', username: 'Kira_Voss', email: null }],
]);

const match = (over: Partial<MatchRow> = {}): MatchRow => ({
  id: 'm1',
  player1_id: 'me',
  player2_id: 'them',
  player1_total_points: 500,
  player2_total_points: 350,
  winner_id: 'me',
  created_at: '2026-10-13T21:00:00Z',
  ended_at: '2026-10-13T21:40:00Z',
  ...over,
});

const round = (over: Partial<RoundRow> = {}): RoundRow => ({
  match_id: 'm1',
  round_number: 1,
  target: 302,
  tiles: [{ id: 'a', value: 75 }, { id: 'b', value: 4 }],
  player1_result: 302,
  player2_result: 305,
  player1_time_ms: 14820,
  player2_time_ms: 9100,
  player1_points: 100,
  player2_points: 50,
  player1_outcome: 'win',
  player2_outcome: 'loss',
  player1_steps: [{ a: 75, op: '×', b: 4, result: 300 }],
  player2_steps: null,
  ...over,
});

describe('formatting', () => {
  it('formats time with two decimals and Timeout for no answer', () => {
    expect(formatSeconds(12430)).toBe('12.43s');
    expect(formatSeconds(null)).toBe('Timeout');
  });
  it('divides stored points by 100', () => {
    expect(formatPoints(100)).toBe('1.00');
    expect(formatPoints(50)).toBe('0.50');
    expect(formatScore(500)).toBe('5');
    expect(formatScore(350)).toBe('3.5');
  });
  it('formats a step', () => {
    expect(formatStep({ a: 25, op: '×', b: 4, result: 100 })).toBe('25 × 4 = 100');
  });
  it('handles a missing or invalid date', () => {
    expect(formatMatchDate(null)).toBe('Unknown date');
    expect(formatMatchDate('nope')).toBe('Unknown date');
    expect(formatMatchDate('2026-10-13T21:40:00Z')).toMatch(/Oct 1[34], 2026 · \d{2}:\d{2}/);
  });
});

describe('isForfeit', () => {
  it('is true only when nobody reached 5 points', () => {
    expect(isForfeit([300, 150])).toBe(true);
    expect(isForfeit([500, 350])).toBe(false);
    expect(isForfeit([200, 500])).toBe(false);
  });
});

describe('tilesToValues', () => {
  it('reads tile objects and plain numbers', () => {
    expect(tilesToValues([{ value: 25 }, 7])).toEqual([25, 7]);
    expect(tilesToValues(null)).toEqual([]);
  });
});

describe('toMatchSummary', () => {
  it('puts me on the left when I am player1', () => {
    const s = toMatchSummary(match(), 'me', profiles, 7);
    expect(s.me).toMatchObject({ name: 'Jenel_29', totalRaw: 500 });
    expect(s.opponent).toMatchObject({ name: 'Kira_Voss', totalRaw: 350 });
    expect(s.didWin).toBe(true);
    expect(s.forfeit).toBe(false);
    expect(s.roundCount).toBe(7);
  });
  it('flips the slots when I am player2', () => {
    const s = toMatchSummary(
      match({ player1_id: 'them', player2_id: 'me', player1_total_points: 200, player2_total_points: 500, winner_id: 'me' }),
      'me', profiles, 5
    );
    expect(s.me.totalRaw).toBe(500);
    expect(s.opponent).toMatchObject({ id: 'them', totalRaw: 200 });
    expect(s.didWin).toBe(true);
  });
  it('marks a loss and a forfeit', () => {
    const s = toMatchSummary(
      match({ player1_total_points: 100, player2_total_points: 300, winner_id: 'them' }),
      'me', profiles, 3
    );
    expect(s.didWin).toBe(false);
    expect(s.forfeit).toBe(true);
  });
  it('falls back to created_at when ended_at is missing', () => {
    expect(toMatchSummary(match({ ended_at: null }), 'me', profiles, 1).endedAt).toBe('2026-10-13T21:00:00Z');
  });
});

describe('toRoundView', () => {
  it('keeps slots when I am player1 and finds the winner', () => {
    const v = toRoundView(round(), true);
    expect(v.me.result).toBe(302);
    expect(v.opponent.result).toBe(305);
    expect(v.winner).toBe('me');
    expect(v.tiles).toEqual([75, 4]);
    expect(v.me.steps).toHaveLength(1);
    expect(v.opponent.steps).toBeNull(); // answered, but steps were never saved
  });
  it('flips everything when I am player2', () => {
    const v = toRoundView(round(), false);
    expect(v.me.result).toBe(305);
    expect(v.me.pointsRaw).toBe(50);
    expect(v.opponent.pointsRaw).toBe(100);
    expect(v.winner).toBe('opponent');
  });
  it('treats no answer as empty steps and a double timeout as a draw', () => {
    const v = toRoundView(
      round({ player1_result: null, player2_result: null, player1_time_ms: null, player2_time_ms: null,
        player1_points: 0, player2_points: 0, player1_outcome: 'draw', player2_outcome: 'draw',
        player1_steps: null, player2_steps: null }),
      true
    );
    expect(v.winner).toBe('draw');
    expect(v.me.steps).toEqual([]);
    expect(v.me.timeMs).toBeNull();
  });
  it('reads numeric points that arrive as strings', () => {
    expect(toRoundView(round({ player1_points: '100' }), true).me.pointsRaw).toBe(100);
  });
});
