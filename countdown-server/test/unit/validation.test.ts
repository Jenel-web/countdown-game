/**
 * Unit tests for src/socket/validation.ts - the checks that sit between raw,
 * untrusted socket payloads and the handlers. Focus is on hostile / malformed
 * input, since that is what these functions exist for.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    isSubmissionTooEarly,
    parseMatchPayload,
    parsePlayerStatus,
    parseRematchResponse,
    parseSubmitPayload,
    safeHandler,
    SUBMIT_EARLY_TOLERANCE_MS,
} from '../../src/socket/validation';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseMatchPayload', () => {
    it('accepts a UUID', () => {
        expect(parseMatchPayload({ matchId: '3f2b7a1e-8c4d-4e6f-9a10-1b2c3d4e5f60' })).toBe(
            '3f2b7a1e-8c4d-4e6f-9a10-1b2c3d4e5f60'
        );
    });

    it('accepts a short readable id (used by tests and old links)', () => {
        expect(parseMatchPayload({ matchId: 'abc_DEF-123' })).toBe('abc_DEF-123');
    });

    it.each([
        ['undefined payload', undefined],
        ['null payload', null],
        ['string payload', 'match-1'],
        ['number payload', 42],
        ['array payload', ['match-1']],
        ['empty object', {}],
        ['matchId null', { matchId: null }],
        ['matchId number', { matchId: 123 }],
        ['matchId object', { matchId: { $ne: null } }],
        ['matchId array', { matchId: ['a'] }],
        ['empty string', { matchId: '' }],
        ['65 chars', { matchId: 'a'.repeat(65) }],
        ['spaces', { matchId: 'a b' }],
        ['SQL-ish', { matchId: "x'; drop table matches;--" }],
        ['filter injection', { matchId: 'a,player1_id.eq.b' }],
        ['path traversal', { matchId: '../../etc' }],
        ['newline', { matchId: 'abc\n' }],
        ['unicode lookalike', { matchId: 'аbc' }], // Cyrillic "а"
    ])('rejects %s', (_label, payload) => {
        expect(parseMatchPayload(payload)).toBeNull();
    });

    it('accepts exactly 64 characters', () => {
        expect(parseMatchPayload({ matchId: 'a'.repeat(64) })).toBe('a'.repeat(64));
    });
});

describe('parseSubmitPayload', () => {
    it('returns the steps array for a well-formed payload', () => {
        const steps = [{ a: 1, op: '+', b: 2, result: 3 }];
        expect(parseSubmitPayload({ steps, resultValue: 3 })).toBe(steps);
    });

    it('does not require resultValue (server ignores it)', () => {
        expect(parseSubmitPayload({ steps: [] })).toEqual([]);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'steps'],
        ['array payload', [[{ a: 1 }]]],
        ['missing steps', { resultValue: 3 }],
        ['steps null', { steps: null }],
        ['steps object', { steps: { 0: { a: 1 } } }],
        ['steps string', { steps: '[]' }],
        ['steps number', { steps: 3 }],
    ])('rejects %s', (_label, payload) => {
        expect(parseSubmitPayload(payload)).toBeNull();
    });

    it('rejects an oversized steps array (cap on work per event)', () => {
        const steps = Array.from({ length: 21 }, () => ({ a: 1, op: '+', b: 1, result: 2 }));
        expect(parseSubmitPayload({ steps })).toBeNull();
    });

    it('lets a 20-element array through for the engine to reject (cap is on size, not legality)', () => {
        const steps = Array.from({ length: 20 }, () => ({ a: 1, op: '+', b: 1, result: 2 }));
        expect(parseSubmitPayload({ steps })).toHaveLength(20);
    });

    it('passes garbage step entries through untouched - the ENGINE is responsible for rejecting them', () => {
        const steps = [null, 7, 'x', [], { a: 'NaN' }];
        expect(parseSubmitPayload({ steps })).toBe(steps);
    });
});

describe('parsePlayerStatus', () => {
    it('accepts the two valid statuses', () => {
        expect(parsePlayerStatus({ status: 'thinking' })).toBe('thinking');
        expect(parsePlayerStatus({ status: 'submitted' })).toBe('submitted');
    });

    it.each([
        [undefined],
        [null],
        ['thinking'],
        [{}],
        [{ status: 'THINKING' }],
        [{ status: 'winner' }],
        [{ status: '<script>alert(1)</script>' }],
        [{ status: ['thinking'] }],
        [{ status: null }],
    ])('rejects %j', (payload) => {
        expect(parsePlayerStatus(payload)).toBeNull();
    });
});

describe('parseRematchResponse', () => {
    it('accepts accept and decline', () => {
        expect(parseRematchResponse({ matchId: 'm1', accepted: true })).toEqual({ matchId: 'm1', accepted: true });
        expect(parseRematchResponse({ matchId: 'm1', accepted: false })).toEqual({ matchId: 'm1', accepted: false });
    });

    it.each([
        [undefined],
        [null],
        [{ matchId: 'm1' }],
        [{ matchId: 'm1', accepted: 'true' }],
        [{ matchId: 'm1', accepted: 1 }],
        [{ matchId: 'm1', accepted: null }],
        [{ accepted: true }],
        [{ matchId: '', accepted: true }],
    ])('rejects %j', (payload) => {
        expect(parseRematchResponse(payload)).toBeNull();
    });
});

describe('isSubmissionTooEarly', () => {
    const start = 1_000_000;

    it('rejects a submission well before the round starts', () => {
        expect(isSubmissionTooEarly(start - 5_000, start)).toBe(true);
    });

    it('allows a submission exactly at the allowance boundary', () => {
        expect(isSubmissionTooEarly(start - SUBMIT_EARLY_TOLERANCE_MS, start)).toBe(false);
    });

    it('rejects one millisecond before the allowance boundary', () => {
        expect(isSubmissionTooEarly(start - SUBMIT_EARLY_TOLERANCE_MS - 1, start)).toBe(true);
    });

    it('allows submissions at and after the start', () => {
        expect(isSubmissionTooEarly(start, start)).toBe(false);
        expect(isSubmissionTooEarly(start + 29_000, start)).toBe(false);
    });

    it('honours a custom tolerance', () => {
        expect(isSubmissionTooEarly(start - 10, start, 0)).toBe(true);
        expect(isSubmissionTooEarly(start - 10, start, 50)).toBe(false);
    });
});

describe('safeHandler', () => {
    it('passes the payload through and runs the handler', () => {
        const fn = vi.fn();
        safeHandler('x', fn)({ a: 1 });
        expect(fn).toHaveBeenCalledWith({ a: 1 });
    });

    it('swallows (and logs) a synchronous throw', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapped = safeHandler('boom', () => {
            throw new Error('sync');
        });
        expect(() => wrapped(undefined)).not.toThrow();
        expect(err).toHaveBeenCalledTimes(1);
    });

    it('swallows (and logs) a rejected promise - no unhandled rejection', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const unhandled = vi.fn();
        process.once('unhandledRejection', unhandled);

        const wrapped = safeHandler('boom', async () => {
            throw new Error('async');
        });
        expect(() => wrapped(null)).not.toThrow();

        await new Promise((r) => setTimeout(r, 20));
        process.removeListener('unhandledRejection', unhandled);

        expect(unhandled).not.toHaveBeenCalled();
        expect(err).toHaveBeenCalledTimes(1);
    });

    it('handles a handler that throws a non-Error value', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapped = safeHandler('weird', () => {
            throw 'a string';
        });
        expect(() => wrapped(1)).not.toThrow();
    });

    it('works for handlers that return nothing', () => {
        expect(() => safeHandler('noop', () => undefined)(0)).not.toThrow();
    });
});
