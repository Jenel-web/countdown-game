/**
 * =============================================================================
 * FILE: src/game/gameEngine.test.ts
 * Comprehensive unit tests for the pure game-logic module — tile/target
 * generation, legal-move enforcement, anti-cheat submission replay, the
 * recursive solvability search, round scoring (every documented rule
 * branch), and match-over detection.
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import {
    LARGE_POOL,
    SMALL_POOL,
    POINTS_SCALE,
    generateTilePool,
    generateTarget,
    applyOp,
    validateSubmission,
    checkSolvability,
    scoreRound,
    checkMatchOver,
    closestValue,
} from './gameEngine';
import type { Tile, Step } from './gameEngine.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — these are load-bearing. If someone edits LARGE_POOL/SMALL_POOL
// later without realizing their exact shape matters, these tests catch it
// immediately instead of surfacing as a confusing bug in generateTilePool.
// ─────────────────────────────────────────────────────────────────────────────
describe('constants', () => {
    it('LARGE_POOL is exactly the four classic Countdown large numbers', () => {
        expect(LARGE_POOL).toEqual([25, 50, 75, 100]);
    });

    it('SMALL_POOL contains exactly two of each number 1–10 (20 total)', () => {
        expect(SMALL_POOL).toHaveLength(20);
        for (let n = 1; n <= 10; n++) {
            expect(SMALL_POOL.filter((v) => v === n)).toHaveLength(2);
        }
    });

    it('POINTS_SCALE is 100 (1.0 point == 100 raw)', () => {
        expect(POINTS_SCALE).toBe(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateTilePool
// ─────────────────────────────────────────────────────────────────────────────
describe('generateTilePool', () => {
    it.each([0, 1, 2, 3, 4] as const)('always returns 6 tiles for largeCount=%i', (n) => {
        const tiles = generateTilePool(n);
        expect(tiles).toHaveLength(6);
    });

    it.each([0, 1, 2, 3, 4] as const)('returns exactly %i large tiles and the rest small', (n) => {
        const tiles = generateTilePool(n);
        const largeTiles = tiles.filter((t) => (LARGE_POOL as readonly number[]).includes(t.value));
        const smallTiles = tiles.filter((t) => t.value >= 1 && t.value <= 10);
        expect(largeTiles).toHaveLength(n);
        expect(smallTiles).toHaveLength(6 - n);
    });

    it("never picks the same large number twice, even when largeCount is the max (4)", () => {
        // Run many trials since this is randomized — a duplicate-large bug
        // might only show up occasionally depending on shuffle order.
        for (let trial = 0; trial < 200; trial++) {
            const tiles = generateTilePool(4);
            const largeValues = tiles.filter((t) => (LARGE_POOL as readonly number[]).includes(t.value)).map((t) => t.value);
            expect(new Set(largeValues).size).toBe(largeValues.length);
        }
    });

    it("'random' always produces between 0 and 4 large tiles, and 6 tiles total", () => {
        for (let trial = 0; trial < 200; trial++) {
            const tiles = generateTilePool('random');
            expect(tiles).toHaveLength(6);
            const largeCount = tiles.filter((t) => (LARGE_POOL as readonly number[]).includes(t.value)).length;
            expect(largeCount).toBeGreaterThanOrEqual(0);
            expect(largeCount).toBeLessThanOrEqual(4);
        }
    });

    it('every tile has a unique id within a single generated pool', () => {
        for (let trial = 0; trial < 50; trial++) {
            const tiles = generateTilePool('random');
            const ids = tiles.map((t) => t.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('all tiles start with used: false and selected: false', () => {
        const tiles = generateTilePool(2);
        for (const t of tiles) {
            expect(t.used).toBe(false);
            expect(t.selected).toBe(false);
        }
    });

    it('clamps out-of-range numeric largeCount instead of breaking (defensive)', () => {
        // Not a documented public contract, but the implementation clamps via
        // Math.max(0, Math.min(4, largeCount)) — verifying that guard actually
        // works protects against a future refactor silently removing it.
        const tooHigh = generateTilePool(99 as any);
        const tooLow = generateTilePool(-5 as any);
        expect(tooHigh.filter((t) => (LARGE_POOL as readonly number[]).includes(t.value))).toHaveLength(4);
        expect(tooLow.filter((t) => (LARGE_POOL as readonly number[]).includes(t.value))).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateTarget
// ─────────────────────────────────────────────────────────────────────────────
describe('generateTarget', () => {
    it('always returns an integer between 100 and 999 inclusive', () => {
        for (let trial = 0; trial < 500; trial++) {
            const t = generateTarget();
            expect(Number.isInteger(t)).toBe(true);
            expect(t).toBeGreaterThanOrEqual(100);
            expect(t).toBeLessThanOrEqual(999);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyOp — legal-move enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('applyOp', () => {
    it('addition: always returns a + b', () => {
        expect(applyOp(3, '+', 4)).toBe(7);
        expect(applyOp(0, '+', 0)).toBe(0); // not reachable with real tiles, but the function itself shouldn't special-case it
    });

    it('subtraction: returns a positive result when a > b', () => {
        expect(applyOp(10, '−', 3)).toBe(7);
    });

    it('subtraction: rejects a result of exactly zero (must be STRICTLY positive)', () => {
        expect(applyOp(5, '−', 5)).toBeNull();
    });

    it('subtraction: rejects negative results (b > a)', () => {
        expect(applyOp(3, '−', 10)).toBeNull();
    });

    it('multiplication: always returns a * b', () => {
        expect(applyOp(6, '×', 7)).toBe(42);
    });

    it('division: returns the exact quotient when it divides evenly', () => {
        expect(applyOp(12, '÷', 3)).toBe(4);
    });

    it('division: rejects a non-integer result (no fractions allowed)', () => {
        expect(applyOp(7, '÷', 2)).toBeNull();
    });

    it('division: rejects division by zero defensively', () => {
        expect(applyOp(5, '÷', 0)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSubmission — the anti-cheat core
// ─────────────────────────────────────────────────────────────────────────────
describe('validateSubmission', () => {
    it('accepts a legitimate single-step submission', () => {
        const result = validateSubmission([25, 50, 3, 7, 7, 9], [
            { a: 25, op: '+', b: 50, result: 75 },
        ]);
        expect(result).toEqual({ valid: true, finalValue: 75 });
    });

    it('accepts a legitimate multi-step submission, chaining a derived tile', () => {
        // pool [2,3,4,5,6,7] -> step1: 2+3=5 (pool becomes [4,5,6,7,5])
        //                    -> step2: 5*4=20 (using the ORIGINAL 5, pool becomes [6,7,5,20])
        const steps: Step[] = [
            { a: 2, op: '+', b: 3, result: 5 },
            { a: 5, op: '×', b: 4, result: 20 },
        ];
        const result = validateSubmission([2, 3, 4, 5, 6, 7], steps);
        expect(result).toEqual({ valid: true, finalValue: 20 });
    });

    it('rejects a submission that reuses a tile that no longer exists in the pool', () => {
        // Only ONE "2" exists in the pool. Step 1 consumes it; step 2 tries to
        // use "2" again — this is exactly the forged-submission scenario the
        // server must catch.
        const steps: Step[] = [
            { a: 2, op: '+', b: 3, result: 5 },
            { a: 2, op: '+', b: 4, result: 6 },
        ];
        const result = validateSubmission([2, 3, 4, 5, 6, 7], steps);
        expect(result).toEqual({ valid: false, finalValue: null });
    });

    it('rejects a submission with a forged result that does not match applyOp', () => {
        // Claims 2 + 3 = 999. The tiles are real and available, but the
        // arithmetic is a lie — this must be caught independently of tile
        // availability.
        const steps: Step[] = [{ a: 2, op: '+', b: 3, result: 999 }];
        const result = validateSubmission([2, 3, 4, 5, 6, 7], steps);
        expect(result).toEqual({ valid: false, finalValue: null });
    });

    it('rejects a submission built on an illegal move (negative subtraction)', () => {
        const steps: Step[] = [{ a: 3, op: '−', b: 10, result: -7 }];
        const result = validateSubmission([3, 10, 4, 5, 6, 7], steps);
        expect(result).toEqual({ valid: false, finalValue: null });
    });

    it('rejects a submission using a value that was never in the original pool at all', () => {
        const steps: Step[] = [{ a: 999, op: '+', b: 1, result: 1000 }];
        const result = validateSubmission([2, 3, 4, 5, 6, 7], steps);
        expect(result).toEqual({ valid: false, finalValue: null });
    });

    it('returns invalid for an empty steps array (documented current limitation)', () => {
        // KNOWN GAP, flagged in review: if a player's raw starting tile
        // already equals the target, there is currently no way to express
        // "I submit this tile with zero operations" as a Step, so this always
        // returns invalid even when the player technically already has a
        // winning tile in hand. This test documents the CURRENT behavior so a
        // future change to fix this gap will intentionally break this test
        // (a good thing) rather than silently changing behavior unnoticed.
        const result = validateSubmission([100, 3, 4, 5, 6, 7], []);
        expect(result).toEqual({ valid: false, finalValue: null });
    });

    it('does not mutate the caller-provided originalTileValues array', () => {
        const original = [2, 3, 4, 5, 6, 7];
        const originalCopy = [...original];
        validateSubmission(original, [{ a: 2, op: '+', b: 3, result: 5 }]);
        expect(original).toEqual(originalCopy);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkSolvability
// ─────────────────────────────────────────────────────────────────────────────
describe('checkSolvability', () => {
    it('is immediately solvable if the target equals one of the raw tiles (zero operations needed)', () => {
        const result = checkSolvability([25, 50, 75, 100, 3, 6], 25);
        expect(result.solvable).toBe(true);
        expect(result.bestDiff).toBe(0);
    });

    it('is always solvable when the target is the sum of every tile (pure addition works regardless of order)', () => {
        const values = [1, 2, 3, 4, 5, 6];
        const target = values.reduce((a, b) => a + b, 0); // 21
        const result = checkSolvability(values, target);
        expect(result.solvable).toBe(true);
        expect(result.bestDiff).toBe(0);
    });

    it('correctly identifies an unreachable target as unsolvable', () => {
        // Small-only tiles with no large numbers: the maximum reachable value
        // via any combination is bounded well below 999, so this target is
        // guaranteed out of reach. We assert solvable:false without pinning an
        // exact bestDiff, since the true maximum achievable value is a fragile
        // thing to hand-compute and isn't the point of this test.
        const result = checkSolvability([1, 1, 2, 2, 3, 3], 999);
        expect(result.solvable).toBe(false);
        expect(result.bestDiff).toBeGreaterThan(0);
    });

    it('does not mutate the input values array', () => {
        const values = [25, 50, 75, 100, 3, 6];
        const copy = [...values];
        checkSolvability(values, 500);
        expect(values).toEqual(copy);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// scoreRound — every documented rule branch
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreRound', () => {
    const TARGET = 500;

    it('both players time out: draw, 0 points each', () => {
        const result = scoreRound(TARGET, true, { result: null, timeMs: null }, { result: null, timeMs: null });
        expect(result.player1).toEqual({ points: 0, pointsRaw: 0, outcome: 'draw' });
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'draw' });
    });

    it('player1 times out: player2 gets an automatic MAX win regardless of how close they actually got', () => {
        // Deliberately far from target — proves the "automatic max win" rule
        // isn't secretly still scoring by distance.
        const result = scoreRound(
            TARGET,
            false,
            { result: null, timeMs: null },
            { result: 1, timeMs: 29000 }
        );
        expect(result.player1).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
        expect(result.player2).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
    });

    it('player2 times out: player1 gets the automatic max win (symmetric case)', () => {
        const result = scoreRound(TARGET, false, { result: 1, timeMs: 29000 }, { result: null, timeMs: null });
        expect(result.player1).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
    });

    it('exact match wins outright: winner gets 1.0, loser beyond 3 away gets 0', () => {
        const result = scoreRound(
            TARGET,
            true,
            { result: 500, timeMs: 10000 },
            { result: 480, timeMs: 12000 } // off by 20
        );
        expect(result.player1).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
    });

    it('exact match wins outright: loser WITHIN 3 of target gets the 0.35 consolation', () => {
        const result = scoreRound(
            TARGET,
            true,
            { result: 500, timeMs: 10000 },
            { result: 497, timeMs: 12000 } // off by exactly 3 — boundary, should qualify
        );
        expect(result.player1).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0.35, pointsRaw: 35, outcome: 'loss' });
    });

    it('exact match: loser boundary — 4 away does NOT qualify for the consolation', () => {
        const result = scoreRound(
            TARGET,
            true,
            { result: 500, timeMs: 10000 },
            { result: 496, timeMs: 12000 } // off by exactly 4 — just over the line
        );
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
    });

    it('an exact match wins even when solvable=false is (incorrectly) passed in — the function trusts a real diff of 0 over the flag', () => {
        // This documents a deliberate design property: scoreRound does not
        // re-derive solvability itself, it trusts whatever `solvable` boolean
        // the caller supplies. A genuine diff-of-zero always short-circuits to
        // the exact-match branch regardless of that flag's value.
        const result = scoreRound(TARGET, false, { result: 500, timeMs: 1000 }, { result: 400, timeMs: 2000 });
        expect(result.player1.pointsRaw).toBe(100);
        expect(result.player1.outcome).toBe('win');
    });

    it('solvable but neither found exact ("both went closest"): winner gets 0.7', () => {
        const result = scoreRound(
            TARGET,
            true,
            { result: 490, timeMs: 10000 }, // off by 10
            { result: 470, timeMs: 12000 }  // off by 30
        );
        expect(result.player1).toEqual({ points: 0.7, pointsRaw: 70, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
    });

    it('solvable-closest: loser within 3 still gets the 0.35 consolation', () => {
        // NOTE: the loser can only ever qualify for this bonus when the winner
        // is ALSO within 3 — the loser's distance can never be smaller than
        // the winner's (that's literally how the winner is chosen), so both
        // values here must be close to target for this scenario to be
        // reachable at all.
        const result = scoreRound(
            TARGET,
            true,
            { result: 498, timeMs: 10000 }, // off by 2 — winner (closer)
            { result: 503, timeMs: 12000 }  // off by 3 — loser, qualifies
        );
        expect(result.player1).toEqual({ points: 0.7, pointsRaw: 70, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0.35, pointsRaw: 35, outcome: 'loss' });
    });

    it('unsolvable: winner within 0–3 gets the full 1.0', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 503, timeMs: 10000 }, // off by 3 — boundary, should still be full points
            { result: 550, timeMs: 12000 }
        );
        expect(result.player1).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
    });

    it('unsolvable: winner boundary — off by 4 drops into the 0.8 bracket, not 1.0', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 504, timeMs: 10000 }, // off by 4
            { result: 550, timeMs: 12000 }
        );
        expect(result.player1).toEqual({ points: 0.8, pointsRaw: 80, outcome: 'win' });
    });

    it('unsolvable: winner boundary — off by 7 is still in the 0.8 bracket', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 507, timeMs: 10000 }, // off by 7
            { result: 550, timeMs: 12000 }
        );
        expect(result.player1).toEqual({ points: 0.8, pointsRaw: 80, outcome: 'win' });
    });

    it('unsolvable: winner boundary — off by 8 drops into the 0.5 bracket', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 508, timeMs: 10000 }, // off by 8
            { result: 550, timeMs: 12000 }
        );
        expect(result.player1).toEqual({ points: 0.5, pointsRaw: 50, outcome: 'win' });
    });

    it('unsolvable: loser within 3 gets the 0.4 consolation (different from the 0.35 used elsewhere)', () => {
        // Same structural note as the solvable-closest case above: the loser
        // can only qualify when the winner is also within 3, since the loser's
        // distance is always >= the winner's.
        const result = scoreRound(
            TARGET,
            false,
            { result: 499, timeMs: 10000 }, // winner, off by 1 -> 1.0 bracket
            { result: 503, timeMs: 12000 }  // loser, off by 3 -> qualifies for 0.4
        );
        expect(result.player1).toEqual({ points: 1, pointsRaw: 100, outcome: 'win' });
        expect(result.player2).toEqual({ points: 0.4, pointsRaw: 40, outcome: 'loss' });
    });

    it('unsolvable: loser boundary — off by 4 does not qualify for the 0.4 consolation', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 499, timeMs: 10000 }, // winner, off by 1
            { result: 504, timeMs: 12000 }  // loser, off by 4 — just over the line
        );
        expect(result.player2).toEqual({ points: 0, pointsRaw: 0, outcome: 'loss' });
    });

    it('same distance, different times: the FASTER player wins', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 505, timeMs: 8000 },  // off by 5, faster
            { result: 495, timeMs: 15000 }  // off by 5, slower
        );
        expect(result.player1.outcome).toBe('win');
        expect(result.player2.outcome).toBe('loss');
    });

    it('same distance, different times: symmetric — player2 faster wins instead', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 505, timeMs: 15000 },
            { result: 495, timeMs: 8000 }
        );
        expect(result.player1.outcome).toBe('loss');
        expect(result.player2.outcome).toBe('win');
    });

    it('true draw (same distance AND same time), unsolvable: both get 0.5', () => {
        const result = scoreRound(
            TARGET,
            false,
            { result: 505, timeMs: 10000 },
            { result: 495, timeMs: 10000 }
        );
        expect(result.player1).toEqual({ points: 0.5, pointsRaw: 50, outcome: 'draw' });
        expect(result.player2).toEqual({ points: 0.5, pointsRaw: 50, outcome: 'draw' });
    });

    it('true draw (same distance AND same time), solvable: both get 0.35', () => {
        const result = scoreRound(
            TARGET,
            true,
            { result: 505, timeMs: 10000 },
            { result: 495, timeMs: 10000 }
        );
        expect(result.player1).toEqual({ points: 0.35, pointsRaw: 35, outcome: 'draw' });
        expect(result.player2).toEqual({ points: 0.35, pointsRaw: 35, outcome: 'draw' });
    });

    it('the `solvable` flag passed in is always echoed back unchanged in the result', () => {
        const r1 = scoreRound(TARGET, true, { result: 500, timeMs: 1 }, { result: 1, timeMs: 1 });
        const r2 = scoreRound(TARGET, false, { result: 500, timeMs: 1 }, { result: 1, timeMs: 1 });
        expect(r1.solvable).toBe(true);
        expect(r2.solvable).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkMatchOver
// ─────────────────────────────────────────────────────────────────────────────
describe('checkMatchOver', () => {
    it('returns null when neither player has reached 5.00 points', () => {
        expect(checkMatchOver(499, 300)).toBeNull();
        expect(checkMatchOver(0, 0)).toBeNull();
    });

    it('returns 1 the instant player1 reaches exactly 500 (5.00) ahead of player2', () => {
        expect(checkMatchOver(500, 300)).toBe(1);
    });

    it('returns 2 the instant player2 reaches exactly 500 ahead of player1', () => {
        expect(checkMatchOver(300, 500)).toBe(2);
    });

    it('returns null at 499 — one raw point below the threshold (boundary check)', () => {
        expect(checkMatchOver(499, 0)).toBeNull();
    });

    it('if both cross 500 in the same call, the higher total wins', () => {
        expect(checkMatchOver(600, 550)).toBe(1);
        expect(checkMatchOver(550, 600)).toBe(2);
    });

    it('if both cross 500 and are EXACTLY equal, resolves to player1 (documented arbitrary tiebreak)', () => {
        // This is an intentionally arbitrary choice per the implementation's
        // own comment — this test exists to make that choice explicit and
        // catch it if it's ever silently changed.
        expect(checkMatchOver(500, 500)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// closestValue
// ─────────────────────────────────────────────────────────────────────────────
describe('closestValue', () => {
    const tile = (value: number, used: boolean): Tile => ({
        id: `t-${value}-${used}`,
        value,
        used,
        selected: false,
    });

    it('finds the unused tile closest to the target', () => {
        const tiles = [tile(100, false), tile(10, false), tile(50, false)];
        const result = closestValue(tiles, 45);
        expect(result).toEqual({ value: 50, diff: 5 });
    });

    it('ignores USED tiles even if one of them would have been a perfect match', () => {
        const tiles = [tile(999, true), tile(10, false)];
        const result = closestValue(tiles, 999);
        expect(result).toEqual({ value: 10, diff: 989 });
    });

    it('falls back to considering ALL tiles if every tile happens to be used', () => {
        const tiles = [tile(100, true), tile(10, true)];
        const result = closestValue(tiles, 95);
        expect(result).toEqual({ value: 100, diff: 5 });
    });

    it('returns a safe default for an empty tile list instead of crashing', () => {
        const result = closestValue([], 500);
        expect(result).toEqual({ value: 0, diff: 500 });
    });
});