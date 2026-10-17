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
    const smallIndices = shuffle(Array.from({ length: SMALL_POOL.length }, (_, i) => i)).slice(0, 6 - n);
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
        default:
            return null; // unknown operator: never return undefined
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

// ─────────────────────────────────────────────────────────────────────────────
// Best-Solution Finder (fewest steps, closest value)
// ─────────────────────────────────────────────────────────────────────────────

export interface BestSolution {
    /** Ordered steps from the original tiles to the best reachable value. Empty if a raw tile is already the best. */
    steps: { a: number; op: string; b: number; result: number }[];
    /** Nested expression, e.g. "(25+50)×3" */
    expression: string;
    /** The value the steps end on. */
    finalValue: number;
    /** |finalValue - target|. 0 means the exact target was reached. */
    diff: number;
}

const SOLVER_OPS = ['+', '\u2212', '\u00D7', '\u00F7'] as const;

/**
 * Finds the reachable value closest to the target using the FEWEST steps.
 * Uses iterative deepening: tries 1 step, then 2, and so on. A later depth
 * only replaces the answer if it is strictly closer, so ties always keep
 * the shorter solution. Legality comes from applyOp(), so the rules are
 * identical to gameplay.
 */
export function findBestSolution(values: number[], target: number): BestSolution {
    type Cand = { value: number; expr: string };

    let bestDiff = Infinity;
    let bestValue = 0;
    let bestExpr = '';
    let bestSteps: BestSolution['steps'] = [];
    const path: BestSolution['steps'] = [];

    function record(c: Cand) {
        const diff = Math.abs(c.value - target);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestValue = c.value;
            bestExpr = c.expr;
            bestSteps = path.slice();
        }
    }

    function dfs(nums: Cand[], remaining: number) {
        if (remaining === 0 || nums.length < 2) return;

        for (let i = 0; i < nums.length - 1; i++) {
            for (let j = i + 1; j < nums.length; j++) {
                const hi = nums[i].value >= nums[j].value ? nums[i] : nums[j];
                const lo = hi === nums[i] ? nums[j] : nums[i];
                const rest = nums.filter((_, idx) => idx !== i && idx !== j);

                for (const op of SOLVER_OPS) {
                    // ×1 and ÷1 never help — they just burn a step.
                    if ((op === '\u00D7' || op === '\u00F7') && lo.value === 1) continue;

                    const result = applyOp(hi.value, op, lo.value);
                    if (result === null) continue;

                    const cand: Cand = { value: result, expr: `(${hi.expr}${op}${lo.expr})` };
                    path.push({ a: hi.value, op, b: lo.value, result });
                    record(cand);
                    if (bestDiff !== 0) dfs([...rest, cand], remaining - 1);
                    path.pop();

                    if (bestDiff === 0) return;
                }
            }
        }
    }

    const initial: Cand[] = values.map((v) => ({ value: v, expr: String(v) }));
    for (const c of initial) record(c); // zero-step answer: a raw tile

    for (let limit = 1; limit <= values.length - 1 && bestDiff !== 0; limit++) {
        dfs(initial, limit);
    }

    const expression =
        bestExpr.startsWith('(') && bestExpr.endsWith(')') ? bestExpr.slice(1, -1) : bestExpr;

    return { steps: bestSteps, expression, finalValue: bestValue, diff: bestDiff };
}



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
    reason?: string;
}

export interface RoundScoreResult {
    player1: PlayerRoundResult;
    player2: PlayerRoundResult;
    solvable: boolean; // safe to reveal in the post-round results screen
}

function toResult(pointsRaw: number, outcome: RoundOutcome, reason?: string): PlayerRoundResult {
    return { points: pointsRaw / POINTS_SCALE, pointsRaw, outcome, reason };
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
    // Defence in depth: a non-finite result (undefined/NaN/Infinity) is treated as a timeout.
    if (p1.result !== null && !Number.isFinite(p1.result)) p1 = { ...p1, result: null };
    if (p2.result !== null && !Number.isFinite(p2.result)) p2 = { ...p2, result: null };

    // Both players failed to submit — draw, no points, no W/L change.
    if (p1.result === null && p2.result === null) {
        return {
            player1: toResult(0, 'draw', 'Both players timed out (0.00 pts)'),
            player2: toResult(0, 'draw', 'Both players timed out (0.00 pts)'),
            solvable,
        };
    }

    // Exactly one player timed out — the other gets an automatic max win.
    if (p1.result === null) {
        return {
            player1: toResult(0, 'loss', 'Timed out / incomplete math (0.00 pts)'),
            player2: toResult(100, 'win', 'Opponent timed out (+1.00 pts)'),
            solvable,
        };
    }
    if (p2.result === null) {
        return {
            player1: toResult(100, 'win', 'Opponent timed out (+1.00 pts)'),
            player2: toResult(0, 'loss', 'Timed out / incomplete math (0.00 pts)'),
            solvable,
        };
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
        const drawReason = solvable
            ? 'Tie on distance & speed (Solvable) (+0.35 pts)'
            : 'Tie on distance & speed (Unsolvable) (+0.50 pts)';
        return {
            player1: toResult(pts, 'draw', drawReason),
            player2: toResult(pts, 'draw', drawReason),
            solvable,
        };
    }

    const winnerDiff = winner === 1 ? d1 : d2;
    const loserDiff = winner === 1 ? d2 : d1;

    let winnerPts: number;
    let loserPts: number;
    let winnerReason: string;
    let loserReason: string;

    if (winnerDiff === 0) {
        // Exact match.
        winnerPts = 100;
        winnerReason = 'Exact Target Hit (🎯 100% Match) (+1.00 pts)';
        if (loserDiff <= 3) {
            loserPts = 35;
            loserReason = `Close Approximation (Diff: ${loserDiff} ≤ 3) (+0.35 pts)`;
        } else {
            loserPts = 0;
            loserReason = `Missed Target (Diff: ${loserDiff} > 3) (0.00 pts)`;
        }
    } else if (solvable) {
        // Target was solvable, but the winner didn't find the exact answer.
        winnerPts = 70;
        winnerReason = (d1 === d2)
            ? `Equal Distance (Diff: ${winnerDiff}), Won on Speed (+0.70 pts)`
            : `Closest Solvable Approximation (Diff: ${winnerDiff}) (+0.70 pts)`;
        if (loserDiff <= 3) {
            loserPts = 35;
            loserReason = `Close Approximation (Diff: ${loserDiff} ≤ 3) (+0.35 pts)`;
        } else {
            loserPts = 0;
            loserReason = `Missed Target (Diff: ${loserDiff} > 3) (0.00 pts)`;
        }
    } else {
        // Target was unsolvable — weighted by how close the winner got.
        if (winnerDiff <= 3) {
            winnerPts = 100;
            winnerReason = `Unsolvable Target: Optimal Approximation (Diff: ${winnerDiff} ≤ 3) (+1.00 pts)`;
        } else if (winnerDiff <= 7) {
            winnerPts = 80;
            winnerReason = `Unsolvable Target: Close Approximation (Diff: ${winnerDiff} ≤ 7) (+0.80 pts)`;
        } else {
            winnerPts = 50;
            winnerReason = `Unsolvable Target: Best Available Math (Diff: ${winnerDiff}) (+0.50 pts)`;
        }

        if (loserDiff <= 3) {
            loserPts = 40;
            loserReason = `Unsolvable Target: Runner-up Within 3 (Diff: ${loserDiff}) (+0.40 pts)`;
        } else {
            loserPts = 0;
            loserReason = `Unsolvable Target: Missed Target (Diff: ${loserDiff} > 3) (0.00 pts)`;
        }
    }

    const p1Pts = winner === 1 ? winnerPts : loserPts;
    const p2Pts = winner === 2 ? winnerPts : loserPts;
    const p1Reason = winner === 1 ? winnerReason : loserReason;
    const p2Reason = winner === 2 ? winnerReason : loserReason;

    return {
        player1: toResult(p1Pts, winner === 1 ? 'win' : 'loss', p1Reason),
        player2: toResult(p2Pts, winner === 2 ? 'win' : 'loss', p2Reason),
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

const VALID_OPS: readonly string[] = ['+', '−', '×', '÷'];

/**
 * Validates a submitted series of arithmetic steps against initial tile values.
 * Never throws: any malformed input yields { valid: false, finalValue: 0 }.
 * Extra unexpected keys on a step are ignored (only a, op, b, result are read).
 */
export function validateSubmission(
    initialTiles: number[],
    steps: Step[]
): { valid: boolean; finalValue: number } {
    const invalid = { valid: false, finalValue: 0 };
    try {
        if (!Array.isArray(steps) || steps.length === 0) return invalid;
        if (!Array.isArray(initialTiles)) return invalid;
        if (steps.length > initialTiles.length - 1) return invalid;

        const available = [...initialTiles];
        let finalValue = 0;

        for (const step of steps) {
            if (step === null || typeof step !== 'object' || Array.isArray(step)) return invalid;
            const { a, op, b, result } = step as Step;

            if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(result)) {
                return invalid;
            }
            if (typeof op !== 'string' || !VALID_OPS.includes(op)) return invalid;

            const idxA = available.indexOf(a);
            if (idxA === -1) return invalid;
            available.splice(idxA, 1);

            const idxB = available.indexOf(b);
            if (idxB === -1) return invalid;
            available.splice(idxB, 1);

            const calculated = applyOp(a, op as '+' | '−' | '×' | '÷', b);
            if (calculated === null || calculated !== result) return invalid;

            available.push(calculated);
            finalValue = result;
        }

        return { valid: true, finalValue };
    } catch {
        return invalid;
    }
}
