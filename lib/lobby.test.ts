import { describe, it, expect } from 'vitest';
import { RANKS, computeRankTier, getRank, getRankProgress } from './ranks';
import { formatRelativeTime } from './lobby';

describe('ranks', () => {
  it('starts everyone at 1000 inside Bronze and covers MMR below it', () => {
    for (const mmr of [0, 500, 1000, 1399]) expect(getRank(mmr).name).toBe('Bronze');
  });

  it('switches rank exactly at each threshold', () => {
    const expected: [number, string][] = [
      [1399, 'Bronze'], [1400, 'Silver'], [1699, 'Silver'], [1700, 'Gold'],
      [1999, 'Gold'], [2000, 'Platinum'], [2299, 'Platinum'], [2300, 'Diamond'],
      [2599, 'Diamond'], [2600, 'Master'], [2999, 'Master'], [3000, 'Grandmaster'],
    ];
    for (const [mmr, name] of expected) expect(getRank(mmr).name).toBe(name);
  });

  it('computeRankTier returns the next threshold for the match screen', () => {
    expect(computeRankTier(1399)).toEqual({ tier: 'Bronze', nextTier: 1400 });
    expect(computeRankTier(1400)).toEqual({ tier: 'Silver', nextTier: 1700 });
    expect(computeRankTier(3000)).toEqual({ tier: 'Grandmaster', nextTier: 3500 });
  });

  it('ranks are strictly ascending', () => {
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].min).toBeGreaterThan(RANKS[i - 1].min);
  });

  it('progress for 1230 MMR: 170 to Silver, 7 wins, 57.5% of the 1000-1400 bar', () => {
    const p = getRankProgress(1230);
    expect(p.rank.name).toBe('Bronze');
    expect(p.nextRank?.name).toBe('Silver');
    expect(p.floor).toBe(1000);
    expect(p.ceiling).toBe(1400);
    expect(p.mmrToGo).toBe(170);
    expect(p.winsToGo).toBe(7);
    expect(p.percent).toBeCloseTo(57.5);
  });

  it('clamps Bronze players below 1000 to 0%', () => {
    expect(getRankProgress(600).percent).toBe(0);
    expect(getRankProgress(0).percent).toBe(0);
  });

  it('uses the rank floor for non-Bronze ranks', () => {
    const p = getRankProgress(1550);
    expect(p.floor).toBe(1400);
    expect(p.ceiling).toBe(1700);
    expect(p.percent).toBeCloseTo(50);
  });

  it('rounds wins to go up (one MMR short is still one win)', () => {
    expect(getRankProgress(1399).winsToGo).toBe(1);
    expect(getRankProgress(1375).winsToGo).toBe(1);
    expect(getRankProgress(1374).winsToGo).toBe(2);
  });

  it('has no next rank at Grandmaster', () => {
    const p = getRankProgress(3200);
    expect(p.nextRank).toBeNull();
    expect(p.percent).toBe(100);
    expect(p.winsToGo).toBe(0);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date(2026, 9, 15, 15, 0, 0).getTime(); // Thu Oct 15 2026, 15:00 local
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const day = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it('handles minutes and hours', () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe('Just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(formatRelativeTime(ago(2 * 3_600_000), now)).toBe('2h ago');
  });

  it('keeps counting hours under 24h, then says Yesterday for the previous calendar day', () => {
    expect(formatRelativeTime(day(2026, 9, 14, 23), now)).toBe('16h ago');
    expect(formatRelativeTime(day(2026, 9, 14, 8), now)).toBe('Yesterday');
  });

  it('uses the weekday within the last week and a date after that', () => {
    expect(formatRelativeTime(day(2026, 9, 12), now)).toBe('Mon');
    expect(formatRelativeTime(day(2026, 9, 3), now)).toBe('Oct 3');
  });

  it('returns empty text for missing or invalid dates', () => {
    expect(formatRelativeTime(null, now)).toBe('');
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});
