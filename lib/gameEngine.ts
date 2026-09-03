/**
 * lib/gameEngine.ts
 * Pure helper functions for Countdown Math Arena game logic.
 * No side effects — safe to import on server or client.
 */

export interface Tile {
  id: string;
  value: number;
  used: boolean;
  selected: boolean;
  isGenerated?: boolean;
}

export interface Step {
  a: number;
  op: string;
  b: number;
  result: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** The four large Countdown numbers. */
export const LARGE_POOL = [25, 50, 75, 100] as const;

/**
 * The small pool: two copies of 1–10 (20 values total).
 * Stored as an array so index-based selection avoids duplicates.
 */
export const SMALL_POOL: number[] = [
  1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
  6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new shuffled copy. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the 6-tile starting pool.
 *
 * @param largeCount  Number of large tiles to include (0–4).
 *                    Pass -1 (or "random") to choose a random count.
 */
export function generateTilePool(largeCount: number | 'random'): Tile[] {
  const n =
    largeCount === 'random'
      ? Math.floor(Math.random() * 5) // 0–4
      : Math.max(0, Math.min(4, largeCount));

  // Pick n unique large numbers
  const large = shuffle([...LARGE_POOL]).slice(0, n);

  // Pick (6 - n) small numbers without reusing the same index slot
  const smallIndices = shuffle([...Array(SMALL_POOL.length).keys()]).slice(0, 6 - n);
  const small = smallIndices.map((i) => SMALL_POOL[i]);

  // Combine: large first, then small
  return [...large, ...small].map((value, i) => ({
    id: `tile-${i}`,
    value,
    used: false,
    selected: false,
  }));
}

/**
 * Generate a random 3-digit target number (100–999 inclusive).
 */
export function generateTarget(): number {
  return Math.floor(Math.random() * 900) + 100;
}

/**
 * Apply an arithmetic operation.
 * Returns the result or null if the operation is invalid by Countdown rules:
 *   - Division must be exact (integer result, divisor ≠ 0)
 *   - Subtraction result must be positive
 */
export function applyOp(
  a: number,
  op: '+' | '−' | '×' | '÷',
  b: number
): number | null {
  switch (op) {
    case '+':
      return a + b;
    case '−': {
      const r = a - b;
      return r > 0 ? r : null;
    }
    case '×':
      return a * b;
    case '÷':
      return b !== 0 && a % b === 0 ? a / b : null;
  }
}

/**
 * Find the closest active tile value to the target.
 * Returns { value, diff }.
 */
export function closestValue(
  tiles: Tile[],
  target: number
): { value: number; diff: number } {
  const active = tiles.filter((t) => !t.used).map((t) => t.value);
  if (active.length === 0) return { value: 0, diff: Infinity };
  const value = active.reduce((best, curr) =>
    Math.abs(curr - target) < Math.abs(best - target) ? curr : best
  );
  return { value, diff: Math.abs(value - target) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Solvability Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface SolveResult {
  solvable: boolean;
  bestDiff: number;
  bestExpression?: string;
}

/**
 * Recursively searches every ordering/combination of the given numbers
 * to determine whether the exact target is reachable, and if not, the
 * closest reachable value.
 */
export function checkSolvability(values: number[], target: number): SolveResult {
  let bestDiff = Infinity;
  let bestExpression: string | undefined;

  type Candidate = { value: number; expr: string };

  function search(numbers: Candidate[]) {
    for (const n of numbers) {
      const diff = Math.abs(n.value - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestExpression = n.expr;
      }
    }
    if (bestDiff === 0) return;

    for (let i = 0; i < numbers.length; i++) {
      for (let j = 0; j < numbers.length; j++) {
        if (i === j) continue;
        const a = numbers[i];
        const b = numbers[j];
        const rest = numbers.filter((_, idx) => idx !== i && idx !== j);
        const candidates: Candidate[] = [];

        candidates.push({ value: a.value + b.value, expr: `(${a.expr}+${b.expr})` });
        if (a.value > b.value) {
          candidates.push({ value: a.value - b.value, expr: `(${a.expr}−${b.expr})` });
        }
        candidates.push({ value: a.value * b.value, expr: `(${a.expr}×${b.expr})` });
        if (b.value !== 0 && a.value % b.value === 0) {
          candidates.push({ value: a.value / b.value, expr: `(${a.expr}÷${b.expr})` });
        }

        for (const c of candidates) {
          if (bestDiff === 0) return;
          search([...rest, c]);
        }
      }
    }
  }

  search(values.map((v) => ({ value: v, expr: String(v) })));
  return { solvable: bestDiff === 0, bestDiff, bestExpression };
}


console.log('TEST checkSolvability:', checkSolvability([25, 50, 75, 100, 3, 6], 952));

// ─────────────────────────────────────────────────────────────────────────────
// Round Scoring Engine
// ─────────────────────────────────────────────────────────────────────────────

/** Internal scale: 100 = 1.0 point. Keeps all math in integers. */
export const POINTS_SCALE = 100;

export interface PlayerSubmission {
  result: number | null; // final value reached; null = did not submit (timeout)
  timeMs: number | null;  // ms from round start to submission; null if no submission
}

export type RoundOutcome = 'win' | 'loss' | 'draw';

export interface PlayerRoundResult {
  points: number;       // decimal, e.g. 0.7 — already divided by POINTS_SCALE
  pointsRaw: number;     // integer, e.g. 70 — store THIS in the database
  outcome: RoundOutcome;
}

export interface RoundScoreResult {
  player1: PlayerRoundResult;
  player2: PlayerRoundResult;
  solvable: boolean; // safe to reveal in the post-round results screen
}

function toResult(pointsRaw: number, outcome: RoundOutcome): PlayerRoundResult {
  return { points: pointsRaw / POINTS_SCALE, pointsRaw, outcome };
}

/**
 * Scores a single round given both players' submissions.
 * target/solvable come from the same generateTarget()/checkSolvability()
 * call used to set up the round.
 */
export function scoreRound(
  target: number,
  solvable: boolean,
  p1: PlayerSubmission,
  p2: PlayerSubmission
): RoundScoreResult {
  // Both players failed to submit — draw, no points, no W/L change.
  if (p1.result === null && p2.result === null) {
    return {
      player1: toResult(0, 'draw'),
      player2: toResult(0, 'draw'),
      solvable,
    };
  }

  // Exactly one player timed out — the other gets an automatic max win.
  if (p1.result === null) {
    return { player1: toResult(0, 'loss'), player2: toResult(100, 'win'), solvable };
  }
  if (p2.result === null) {
    return { player1: toResult(100, 'win'), player2: toResult(0, 'loss'), solvable };
  }

  const d1 = Math.abs(p1.result - target);
  const d2 = Math.abs(p2.result - target);

  // Determine the winner: closer distance wins; tie on distance -> faster time; tie on both -> draw.
  let winner: 1 | 2 | 'draw';
  if (d1 < d2) winner = 1;
  else if (d2 < d1) winner = 2;
  else if (p1.timeMs! < p2.timeMs!) winner = 1;
  else if (p2.timeMs! < p1.timeMs!) winner = 2;
  else winner = 'draw';

  if (winner === 'draw') {
    const pts = solvable ? 35 : 50;
    return { player1: toResult(pts, 'draw'), player2: toResult(pts, 'draw'), solvable };
  }

  const winnerDiff = winner === 1 ? d1 : d2;
  const loserDiff = winner === 1 ? d2 : d1;

  let winnerPts: number;
  let loserPts: number;

  if (winnerDiff === 0) {
    // Exact match.
    winnerPts = 100;
    loserPts = loserDiff <= 3 ? 35 : 0;
  } else if (solvable) {
    // Target was solvable, but the winner didn't find the exact answer.
    winnerPts = 70;
    loserPts = loserDiff <= 3 ? 35 : 0;
  } else {
    // Target was unsolvable — weighted by how close the winner got.
    winnerPts = winnerDiff <= 3 ? 100 : winnerDiff <= 7 ? 80 : 50;
    loserPts = loserDiff <= 3 ? 40 : 0;
  }

  const p1Pts = winner === 1 ? winnerPts : loserPts;
  const p2Pts = winner === 2 ? winnerPts : loserPts;

  return {
    player1: toResult(p1Pts, winner === 1 ? 'win' : 'loss'),
    player2: toResult(p2Pts, winner === 2 ? 'win' : 'loss'),
    solvable,
  };
}

/**
 * Checks whether a match has been won. Pass cumulative RAW (integer) totals.
 * Returns 1, 2, or null if nobody has reached 5 points yet.
 */
export function checkMatchOver(p1TotalRaw: number, p2TotalRaw: number): 1 | 2 | null {
  const MATCH_TARGET_RAW = 5 * POINTS_SCALE; // 500
  if (p1TotalRaw >= MATCH_TARGET_RAW && p1TotalRaw > p2TotalRaw) return 1;
  if (p2TotalRaw >= MATCH_TARGET_RAW && p2TotalRaw > p1TotalRaw) return 2;
  if (p1TotalRaw >= MATCH_TARGET_RAW && p2TotalRaw >= MATCH_TARGET_RAW) {
    return p1TotalRaw >= p2TotalRaw ? 1 : 2; // both crossed in the same round — higher total wins
  }
  return null;
}

console.log('TEST scoreRound (exact vs miss, solvable):', scoreRound(
  500, true,
  { result: 500, timeMs: 12000 },  // player 1: exact
  { result: 480, timeMs: 15000 }   // player 2: off by 20
));
// Expect: player1 { points: 1, outcome: 'win' }, player2 { points: 0, outcome: 'loss' }

console.log('TEST scoreRound (unsolvable, both timeout):', scoreRound(
  500, false,
  { result: null, timeMs: null },
  { result: null, timeMs: null }
));
// Expect: both { points: 0, outcome: 'draw' }