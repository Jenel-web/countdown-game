import { describe, it, expect } from 'vitest';
import {
  applyOp,
  validateSubmission,
  scoreRound,
  checkMatchOver,
  type Step,
} from '../../src/game/gameEngine';

const POOL = [25, 5, 3, 2, 1, 1];
const MINUS = '−';
const TIMES = '×';
const DIV = '÷';
const bad = { valid: false, finalValue: 0 };
const v = (steps: unknown, pool: number[] = POOL) =>
  validateSubmission(pool, steps as Step[]);

describe('applyOp', () => {
  it('valid ops unchanged', () => {
    expect(applyOp(3, '+', 4)).toBe(7);
    expect(applyOp(10, MINUS, 3)).toBe(7);
    expect(applyOp(5, MINUS, 5)).toBeNull();
    expect(applyOp(3, MINUS, 10)).toBeNull();
    expect(applyOp(6, TIMES, 7)).toBe(42);
    expect(applyOp(12, DIV, 3)).toBe(4);
    expect(applyOp(7, DIV, 2)).toBeNull();
    expect(applyOp(5, DIV, 0)).toBeNull();
  });
  it('returns null (not undefined) for unknown ops', () => {
    for (const op of ['?', '-', 'x', '*', '/', '', 'plus']) {
      expect(applyOp(2, op as never, 3)).toBeNull();
    }
    expect(applyOp(2, undefined as never, 3)).toBeNull();
  });
});

describe('validateSubmission: valid cases unchanged', () => {
  it('single step', () => {
    expect(v([{ a: 25, op: '+', b: 5, result: 30 }])).toEqual({ valid: true, finalValue: 30 });
  });
  it('chains intermediate results; finalValue is last result', () => {
    expect(
      v([
        { a: 25, op: '+', b: 5, result: 30 },
        { a: 30, op: TIMES, b: 3, result: 90 },
        { a: 90, op: MINUS, b: 2, result: 88 },
      ])
    ).toEqual({ valid: true, finalValue: 88 });
  });
  it('duplicate tiles in the pool (two 1s) may both be used', () => {
    expect(v([{ a: 1, op: '+', b: 1, result: 2 }])).toEqual({ valid: true, finalValue: 2 });
  });
  it('5 steps (tiles - 1) is allowed', () => {
    const r = v([
      { a: 1, op: '+', b: 1, result: 2 },
      { a: 2, op: '+', b: 2, result: 4 },
      { a: 4, op: '+', b: 3, result: 7 },
      { a: 7, op: '+', b: 5, result: 12 },
      { a: 12, op: '+', b: 25, result: 37 },
    ]);
    expect(r).toEqual({ valid: true, finalValue: 37 });
  });
  it('extra unexpected keys on a step are ignored (documented: allowed)', () => {
    expect(v([{ a: 25, op: '+', b: 5, result: 30, note: 'hi', score: 99999 }])).toEqual({
      valid: true,
      finalValue: 30,
    });
  });
  it('does not mutate inputs', () => {
    const pool = [...POOL];
    const steps = [{ a: 25, op: '+', b: 5, result: 30 }];
    const snapPool = JSON.stringify(pool);
    const snapSteps = JSON.stringify(steps);
    validateSubmission(pool, steps);
    expect(JSON.stringify(pool)).toBe(snapPool);
    expect(JSON.stringify(steps)).toBe(snapSteps);
  });
});

describe('validateSubmission: forged / malformed', () => {
  it('exploit: unknown op with missing result is invalid', () => {
    expect(v([{ a: 25, op: '?', b: 5 }])).toEqual(bad);
    expect(v([{ a: 25, op: '?', b: 5, result: undefined }])).toEqual(bad);
  });
  it('missing result on a valid op', () => {
    expect(v([{ a: 25, op: '+', b: 5 }])).toEqual(bad);
  });
  it('wrong result', () => {
    expect(v([{ a: 25, op: '+', b: 5, result: 31 }])).toEqual(bad);
  });
  it('ASCII operators rejected', () => {
    for (const op of ['-', 'x', '*', '/', 'X']) {
      expect(v([{ a: 25, op, b: 5, result: 20 }])).toEqual(bad);
    }
  });
  it('unicode lookalike operators rejected', () => {
    const ops = [
      '‒', '–', '—', '−​', '✕', '✖',
      '⋅', '⁄', '∕', '÷÷', '＋', ' +',
    ];
    for (const op of ops) {
      expect(v([{ a: 25, op, b: 5, result: 30 }])).toEqual(bad);
    }
  });
  it('non-string ops rejected', () => {
    for (const op of [null, undefined, 1, true, ['+'], { toString: () => '+' }]) {
      expect(v([{ a: 25, op, b: 5, result: 30 }])).toEqual(bad);
    }
  });
  it('bad numeric types for a, b, result', () => {
    const badVals = [NaN, Infinity, -Infinity, 1.5, '25', '5', true, null, undefined, {}, [25], 2 ** 53];
    for (const x of badVals) {
      expect(v([{ a: x, op: '+', b: 5, result: 30 }])).toEqual(bad);
      expect(v([{ a: 25, op: '+', b: x, result: 30 }])).toEqual(bad);
      expect(v([{ a: 25, op: '+', b: 5, result: x }])).toEqual(bad);
    }
  });
  it('-0 is not a pool member', () => {
    expect(v([{ a: -0, op: '+', b: 5, result: 5 }])).toEqual(bad);
    expect(v([{ a: 25, op: '+', b: 5, result: -0 }])).toEqual(bad);
  });
  it('step entries of the wrong type never throw', () => {
    for (const entry of [null, undefined, 5, 'x', true, [], [25, '+', 5, 30], () => 1]) {
      expect(() => v([entry])).not.toThrow();
      expect(v([entry])).toEqual(bad);
    }
    expect(v([{ a: 25, op: '+', b: 5, result: 30 }, null])).toEqual(bad);
  });
  it('non-array steps', () => {
    const inputs = [
      null, undefined, {}, 'abc', 5, true,
      { length: 1, 0: { a: 25, op: '+', b: 5, result: 30 } },
    ];
    for (const s of inputs) {
      expect(v(s)).toEqual(bad);
    }
  });
  it('empty array', () => {
    expect(v([])).toEqual(bad);
  });
  it('non-array tiles never throw', () => {
    expect(validateSubmission(null as never, [{ a: 1, op: '+', b: 1, result: 2 }])).toEqual(bad);
  });
  it('throwing getter does not throw out', () => {
    const evil = {
      get a(): number {
        throw new Error('boom');
      },
      op: '+',
      b: 5,
      result: 30,
    };
    expect(() => v([evil])).not.toThrow();
    expect(v([evil])).toEqual(bad);
  });
  it('more than tiles-1 steps (6) invalid', () => {
    const s = { a: 1, op: '+', b: 1, result: 2 };
    expect(v([s, s, s, s, s, s])).toEqual(bad);
  });
  it('value not in pool', () => {
    expect(v([{ a: 99, op: '+', b: 5, result: 104 }])).toEqual(bad);
    expect(v([{ a: 25, op: '+', b: 99, result: 124 }])).toEqual(bad);
  });
  it('same tile twice when only one copy exists', () => {
    expect(v([{ a: 25, op: '+', b: 25, result: 50 }])).toEqual(bad);
    expect(v([{ a: 5, op: TIMES, b: 5, result: 25 }])).toEqual(bad);
  });
  it('a consumed tile cannot be reused', () => {
    expect(
      v([
        { a: 25, op: '+', b: 5, result: 30 },
        { a: 25, op: '+', b: 3, result: 28 },
      ])
    ).toEqual(bad);
  });
  it('subtraction to zero / negative', () => {
    expect(v([{ a: 1, op: MINUS, b: 1, result: 0 }])).toEqual(bad);
    expect(v([{ a: 2, op: MINUS, b: 5, result: -3 }])).toEqual(bad);
  });
  it('non-exact division and division by zero', () => {
    const pool = [5, 0, 1, 1, 1, 1];
    expect(v([{ a: 5, op: DIV, b: 2, result: 2.5 }])).toEqual(bad);
    expect(v([{ a: 5, op: DIV, b: 2, result: 2 }])).toEqual(bad);
    expect(v([{ a: 5, op: DIV, b: 0, result: Infinity }], pool)).toEqual(bad);
    expect(v([{ a: 5, op: DIV, b: 0, result: 0 }], pool)).toEqual(bad);
  });
  it('exact division is valid', () => {
    expect(v([{ a: 25, op: DIV, b: 5, result: 5 }])).toEqual({ valid: true, finalValue: 5 });
  });
  it('huge / unsafe integers', () => {
    const big = Number.MAX_SAFE_INTEGER + 1;
    expect(v([{ a: big, op: '+', b: 1, result: big + 1 }], [big, 1, 1, 1, 1, 1])).toEqual(bad);
    expect(v([{ a: 25, op: TIMES, b: 5, result: 125 + 2 ** 60 }])).toEqual(bad);
    expect(v([{ a: 1e300, op: '+', b: 1, result: 1e300 }], [1e300, 1, 1, 1, 1, 1])).toEqual(bad);
  });
  it('prototype-pollution style keys', () => {
    const steps = JSON.parse('[{"__proto__":{"a":25,"op":"+","b":5,"result":30}}]');
    expect(v(steps)).toEqual(bad);
    const withProto = JSON.parse(
      '[{"a":25,"op":"+","b":5,"result":31,"__proto__":{"result":30}}]'
    );
    expect(v(withProto)).toEqual(bad);
    const ctor = JSON.parse(
      '[{"constructor":{"prototype":{"polluted":1}},"a":25,"op":"+","b":5,"result":30}]'
    );
    expect(v(ctor)).toEqual({ valid: true, finalValue: 30 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('scoreRound hardening', () => {
  const sub = (result: unknown, timeMs: number | null = 1000) => ({
    result: result as number | null,
    timeMs,
  });

  it.each([[NaN], [undefined], [Infinity], [-Infinity]])(
    'bad result %s on one side loses to a legit result and never yields NaN',
    (bv) => {
      const r1 = scoreRound(500, true, sub(bv, 1), sub(480, 9000));
      expect(r1.player1.outcome).toBe('loss');
      expect(r1.player2.outcome).toBe('win');
      expect(r1.player2.pointsRaw).toBe(100);
      const r2 = scoreRound(500, true, sub(480, 9000), sub(bv, 1));
      expect(r2.player2.outcome).toBe('loss');
      expect(r2.player1.pointsRaw).toBe(100);
      for (const p of [r1.player1, r1.player2, r2.player1, r2.player2]) {
        expect(Number.isNaN(p.pointsRaw)).toBe(false);
        expect(Number.isNaN(p.points)).toBe(false);
        expect(Number.isInteger(p.pointsRaw)).toBe(true);
      }
    }
  );
  it('both non-finite is a draw with 0 points', () => {
    const r = scoreRound(500, true, sub(NaN), sub(undefined));
    expect(r.player1).toMatchObject({ pointsRaw: 0, outcome: 'draw' });
    expect(r.player2).toMatchObject({ pointsRaw: 0, outcome: 'draw' });
  });
  it('non-finite vs null is a draw', () => {
    const r = scoreRound(500, true, sub(NaN), sub(null, null));
    expect(r.player1.outcome).toBe('draw');
    expect(r.player2.outcome).toBe('draw');
  });
  it('regression: forged-op exploit scores as timeout; opponent exact hit gets +1.00', () => {
    const forged = validateSubmission(POOL, [{ a: 25, op: '?', b: 5 } as unknown as Step]);
    expect(forged.valid).toBe(false);
    const r = scoreRound(
      100,
      true,
      sub(forged.valid ? forged.finalValue : null, 1),
      sub(100, 20000)
    );
    expect(r.player1).toMatchObject({ pointsRaw: 0, outcome: 'loss' });
    expect(r.player2).toMatchObject({ pointsRaw: 100, outcome: 'win' });
    // Even if the old undefined leaked through, it is still a timeout.
    const leaked = scoreRound(100, true, sub(undefined, 1), sub(100, 20000));
    expect(leaked.player1.pointsRaw).toBe(0);
    expect(leaked.player2.pointsRaw).toBe(100);
  });

  describe('valid scoring paths unchanged', () => {
    it('exact vs close', () => {
      const r = scoreRound(500, true, sub(500, 5000), sub(498, 1000));
      expect(r.player1).toMatchObject({ pointsRaw: 100, outcome: 'win' });
      expect(r.player2).toMatchObject({ pointsRaw: 35, outcome: 'loss' });
    });
    it('exact vs far', () => {
      const r = scoreRound(500, true, sub(500), sub(480, 1));
      expect(r.player2.pointsRaw).toBe(0);
    });
    it('solvable closest wins 70', () => {
      const r = scoreRound(500, true, sub(497), sub(490));
      expect(r.player1.pointsRaw).toBe(70);
      expect(r.player2.pointsRaw).toBe(0);
    });
    it('equal distance goes to the faster player', () => {
      const r = scoreRound(500, true, sub(497, 9000), sub(503, 2000));
      expect(r.player2).toMatchObject({ pointsRaw: 70, outcome: 'win' });
      expect(r.player1).toMatchObject({ pointsRaw: 35, outcome: 'loss' });
    });
    it('same distance and time: draw 35 solvable / 50 unsolvable', () => {
      expect(scoreRound(500, true, sub(497, 5), sub(503, 5)).player1.pointsRaw).toBe(35);
      expect(scoreRound(500, false, sub(497, 5), sub(503, 5)).player2.pointsRaw).toBe(50);
    });
    it('unsolvable tiers 100/80/50, loser 40/0', () => {
      expect(scoreRound(500, false, sub(498), sub(499, 1)).player2.pointsRaw).toBe(100);
      expect(scoreRound(500, false, sub(494), sub(480)).player1.pointsRaw).toBe(80);
      expect(scoreRound(500, false, sub(490), sub(450)).player1.pointsRaw).toBe(50);
      expect(scoreRound(500, false, sub(499), sub(502)).player2.pointsRaw).toBe(40);
      expect(scoreRound(500, false, sub(499), sub(450)).player2.pointsRaw).toBe(0);
    });
    it('timeouts', () => {
      expect(scoreRound(500, true, sub(null, null), sub(1, 1)).player2.pointsRaw).toBe(100);
      expect(scoreRound(500, true, sub(1, 1), sub(null, null)).player1.pointsRaw).toBe(100);
      expect(scoreRound(500, true, sub(null, null), sub(null, null)).player1.outcome).toBe('draw');
    });
    it('a result of 0 is a real (finite) result, not a timeout', () => {
      const r = scoreRound(500, true, sub(0, 1), sub(null, null));
      expect(r.player1).toMatchObject({ pointsRaw: 100, outcome: 'win' });
    });
  });
});

describe('checkMatchOver unchanged', () => {
  it('basics', () => {
    expect(checkMatchOver(499, 499)).toBeNull();
    expect(checkMatchOver(500, 100)).toBe(1);
    expect(checkMatchOver(100, 500)).toBe(2);
    expect(checkMatchOver(550, 600)).toBe(2);
    expect(checkMatchOver(600, 550)).toBe(1);
  });
  it('current behaviour: exact tie at/over 500 favours player 1', () => {
    expect(checkMatchOver(500, 500)).toBe(1);
  });
});
