/** MMR a win gains / a loss costs. Fixed by the finish_match database function. */
export const MMR_WIN = 25;
export const MMR_LOSS = 15;

export interface RankTier {
  name: string;
  /** Lowest MMR in this rank. */
  min: number;
}

/** Lowest to highest. New players start at 1000, inside Bronze. */
export const RANKS: RankTier[] = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 1400 },
  { name: 'Gold', min: 1700 },
  { name: 'Platinum', min: 2000 },
  { name: 'Diamond', min: 2300 },
  { name: 'Master', min: 2600 },
  { name: 'Grandmaster', min: 3000 },
];

/** Where the Bronze progress bar starts (new players' starting MMR). */
const BRONZE_BAR_FLOOR = 1000;
/** Ceiling shown for the top rank, which has no next rank. */
const TOP_RANK_NEXT = 3500;

export function getRank(mmr: number): RankTier {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (mmr >= rank.min) current = rank;
  }
  return current;
}

/** Rank name plus the MMR where the next rank begins. Used by the match screen. */
export function computeRankTier(mmr: number): { tier: string; nextTier: number } {
  const index = RANKS.indexOf(getRank(mmr));
  const next = RANKS[index + 1];
  return { tier: RANKS[index].name, nextTier: next ? next.min : TOP_RANK_NEXT };
}

export interface RankProgress {
  rank: RankTier;
  /** null at the top rank. */
  nextRank: RankTier | null;
  /** MMR where the progress bar starts and ends. */
  floor: number;
  ceiling: number;
  mmrToGo: number;
  /** Wins needed at +25 each, rounded up. */
  winsToGo: number;
  /** 0-100 position of the player between floor and ceiling. */
  percent: number;
}

export function getRankProgress(mmr: number): RankProgress {
  const rank = getRank(mmr);
  const index = RANKS.indexOf(rank);
  const nextRank = RANKS[index + 1] ?? null;
  const floor = index === 0 ? BRONZE_BAR_FLOOR : rank.min;

  if (!nextRank) {
    return { rank, nextRank: null, floor, ceiling: floor, mmrToGo: 0, winsToGo: 0, percent: 100 };
  }

  const ceiling = nextRank.min;
  const mmrToGo = ceiling - mmr;
  const raw = ((mmr - floor) / (ceiling - floor)) * 100;
  return {
    rank,
    nextRank,
    floor,
    ceiling,
    mmrToGo,
    winsToGo: Math.ceil(mmrToGo / MMR_WIN),
    percent: Math.min(100, Math.max(0, raw)),
  };
}
