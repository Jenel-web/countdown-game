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
  op: '+' | '−' | '×' | '÷'; // Change from string to literal union
  b: number;
  result: number;
}
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** The four large Countdown numbers. */
export const LARGE_POOL = [25, 50, 75, 100] as const;

/** Two copies of 1–10 (20 values total) — the classic Countdown small pool. */
export const SMALL_POOL: number[] = [
  1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
  6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
];

/** Internal points scale: 100 = 1.0 point. Keeps all scoring math in
 *  integers, avoiding JavaScript floating-point rounding bugs (e.g.
 *  0.1 + 0.2 !== 0.3) when comparing totals against the 5-point match target. */
export const POINTS_SCALE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new shuffled copy, never mutates the input. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile / target generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the 6-tile starting pool for a round.
 * @param largeCount  Number of large tiles to include (0–4), or 'random'.
 */
export function generateTilePool(largeCount: number | 'random'): Tile[] {
  const n =
    largeCount === 'random'
      ? Math.floor(Math.random() * 5) // 0–4 inclusive
      : Math.max(0, Math.min(4, largeCount));

  const large = shuffle([...LARGE_POOL]).slice(0, n);

  // Pick (6 - n) small numbers by shuffling INDICES (not values) so we
  // don't accidentally pick the "same" 7 twice from two different slots
  // that both happen to hold a 7 — index-based selection sidesteps that.
  const smallIndices = shuffle([...Array(SMALL_POOL.length).keys()]).slice(0, 6 - n);
  const small = smallIndices.map((i) => SMALL_POOL[i]);

  return [...large, ...small].map((value, i) => ({
    id: `tile-${i}-${Date.now()}`,
    value,
    used: false,
    selected: false,
  }));
}

/** Generate a random 3-digit target number (100–999 inclusive). */
export function generateTarget(): number {
  return Math.floor(Math.random() * 900) + 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legal-move logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply one arithmetic operation. Returns the result, or null if the move
 * is ILLEGAL by Countdown's rules:
 *   - subtraction must produce a positive result (no negative numbers)
 *   - division must be exact — an integer result only (no fractions)
 */
export function applyOp(a: number, op: '+' | '−' | '×' | '÷', b: number): number | null {
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
 * Re-plays a submitted sequence of Steps against the ORIGINAL tile values
 * for the round, to independently confirm the claimed final result is
 * actually achievable — legally, with real tiles, no reuse.
 *
 * THIS is the function that makes the server "authoritative": we never
 * take a client's word for what they scored. We recompute it ourselves
 * from their claimed working-out, using only tiles that genuinely existed.
 *
 * How the replay works, step by step:
 *  1. Start with a "pool" — a plain array copy of the round's original
 *     tile values (e.g. [25, 50, 3, 7, 7, 9]).
 *  2. For each submitted Step, try to REMOVE both `a` and `b` from that
 *     pool. If either value isn't currently available, the submission is
 *     lying about which tiles it used — reject immediately.
 *  3. Confirm the step's claimed `result` actually matches what applyOp
 *     would produce from `a` and `b` — this catches a forged/incorrect
 *     result even if the tiles themselves were legitimately available.
 *  4. Push `result` back into the pool — a derived tile becomes available
 *     for later steps, exactly like it does in the real UI.
 *  5. If every step passes, the LAST step's result is the player's final
 *     achieved value.
 */
export function validateSubmission(
  originalTileValues: number[],
  steps: Step[]
): { valid: boolean; finalValue: number | null } {
  const pool = [...originalTileValues];

  function take(value: number): boolean {
    const idx = pool.indexOf(value);
    if (idx === -1) return false;
    pool.splice(idx, 1);
    return true;
  }

  if (steps.length === 0) {
    // No moves submitted at all isn't necessarily "invalid" (a player
    // might legitimately submit a raw starting tile as their answer if it
    // happens to equal the target) — but that case has no Steps to
    // validate, so the caller should handle "0 steps" as its own case
    // before calling this function if that's a scenario you want to allow.
    return { valid: false, finalValue: null };
  }

  for (const step of steps) {
    if (!take(step.a)) return { valid: false, finalValue: null };
    if (!take(step.b)) return { valid: false, finalValue: null };

    const expected = applyOp(step.a, step.op, step.b);
    if (expected === null || expected !== step.result) {
      return { valid: false, finalValue: null };
    }

    pool.push(step.result);
  }

  return { valid: true, finalValue: steps[steps.length - 1].result };
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
 * Recursively searches every ordering/combination of the given numbers to
 * determine whether the exact target is reachable, and — either way — the
 * single closest reachable value. This runs ONCE per round, at round-start
 * time, server-side, and its `solvable` result is what drives scoreRound's
 * branching logic later.
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
    if (bestDiff === 0) return; // found an exact solution — stop searching

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

// ─────────────────────────────────────────────────────────────────────────────
// Round Scoring Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerSubmission {
  /** Final value reached, from validateSubmission(). null = no submission (timeout). */
  result: number | null;
  /** Milliseconds from round start to submission. null if no submission. */
  timeMs: number | null;
}

export type RoundOutcome = 'win' | 'loss' | 'draw';

export interface PlayerRoundResult {
  points: number;     // decimal, e.g. 0.7 — for DISPLAY only
  pointsRaw: number;   // integer, e.g. 70 — store THIS in the database
  outcome: RoundOutcome;
}

export interface RoundScoreResult {
  player1: PlayerRoundResult;
  player2: PlayerRoundResult;
  /** Safe to reveal to players AFTER the round ends — never during play. */
  solvable: boolean;
}

function toResult(pointsRaw: number, outcome: RoundOutcome): PlayerRoundResult {
  return { points: pointsRaw / POINTS_SCALE, pointsRaw, outcome };
}

/**
 * Scores a single round given both players' submissions. This is a direct
 * implementation of the point rules we designed together:
 *  - Exact match: winner 1.0, loser 0.35 if within 3 of target else 0
 *  - Solvable but neither found exact ("both went closest"): winner 0.7,
 *    same loser rule as above
 *  - Unsolvable: winner scored 1.0 / 0.8 / 0.5 by how close (0–3 / 4–7 / 8+),
 *    loser gets 0.4 if also within 3, else 0
 *  - Same distance, different times: faster player wins, scored per the
 *    applicable row above
 *  - Same distance AND same time: draw, 0.35 each if solvable, 0.5 each if not
 *  - One player times out: opponent gets an automatic max win (1.0), the
 *    timed-out player gets 0 and a loss
 *  - Both time out: draw, 0 points each, no win/loss change
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

  // Determine the winner: closer distance wins; tie on distance -> faster
  // time wins; tie on BOTH -> a true draw.
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
 * Checks whether a match has been won. Pass CUMULATIVE RAW (integer)
 * totals — i.e. the running sum of every round's pointsRaw so far.
 * Returns 1, 2, or null if nobody has reached 5 points yet.
 */
export function checkMatchOver(p1TotalRaw: number, p2TotalRaw: number): 1 | 2 | null {
  const MATCH_TARGET_RAW = 5 * POINTS_SCALE; // 500 = 5.00 points
  if (p1TotalRaw >= MATCH_TARGET_RAW && p1TotalRaw > p2TotalRaw) return 1;
  if (p2TotalRaw >= MATCH_TARGET_RAW && p2TotalRaw > p1TotalRaw) return 2;
  if (p1TotalRaw >= MATCH_TARGET_RAW && p2TotalRaw >= MATCH_TARGET_RAW) {
    // Both crossed 5 in the very same round (possible via a tie-scored
    // draw pushing both over) — whoever has the higher total wins; if
    // still exactly equal, this returns 1 arbitrarily. Extremely rare edge
    // case; revisit if you want a different tiebreak here later.
    return p1TotalRaw >= p2TotalRaw ? 1 : 2;
  }
  return null;
}

/**
 * Finds the remaining (unused) tile closest to the target number.
 * Returns the best achieved value and its absolute difference from target.
 */
export function closestValue(
  tiles: Tile[],
  target: number
): { value: number; diff: number } {
  const available = tiles.filter((t) => !t.used);
  const pool = available.length > 0 ? available : tiles;

  if (pool.length === 0) {
    return { value: 0, diff: target };
  }

  let bestValue = pool[0].value;
  let minDiff = Math.abs(bestValue - target);

  for (const tile of pool) {
    const diff = Math.abs(tile.value - target);
    if (diff < minDiff) {
      minDiff = diff;
      bestValue = tile.value;
    }
  }

  return { value: bestValue, diff: minDiff };
}