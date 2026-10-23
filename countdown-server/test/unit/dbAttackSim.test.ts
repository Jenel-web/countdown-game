/**
 * Tests for the pure parts of scripts/db-attack-sim.ts: the key check that keeps
 * a policy-bypassing key out of the script, and the report. (The checks
 * themselves run against a real Supabase project and are run by hand.)
 */

import { describe, it, expect } from 'vitest';
import { assertPublicKey, cleanSecret, describeToken, formatReport, type CheckResult } from '../../scripts/db-attack-sim';

/** Builds an unsigned JWT-shaped string with the given payload. */
function fakeJwt(payload: Record<string, unknown>): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

describe('assertPublicKey', () => {
    it('accepts a legacy anon JWT', () => {
        expect(() => assertPublicKey(fakeJwt({ role: 'anon', iss: 'supabase' }))).not.toThrow();
    });

    it('accepts a new-style publishable key', () => {
        expect(() => assertPublicKey('sb_publishable_abc123')).not.toThrow();
    });

    it('refuses a legacy service-role JWT', () => {
        expect(() => assertPublicKey(fakeJwt({ role: 'service_role', iss: 'supabase' }))).toThrow(/SERVICE ROLE/);
    });

    it('refuses a new-style secret key', () => {
        expect(() => assertPublicKey('sb_secret_abc123')).toThrow(/SECRET/);
    });

    it('does not crash on something that is not a JWT', () => {
        expect(() => assertPublicKey('a.b.c')).not.toThrow();
        expect(() => assertPublicKey('')).not.toThrow();
    });
});

describe('formatReport', () => {
    const r = (id: string, expected: 'ALLOWED' | 'BLOCKED', outcome: CheckResult['outcome']): CheckResult => ({
        id, title: `check ${id}`, expected, closedBy: 'lockdown-a', outcome, detail: '',
    });

    it('flags open holes and reports the count', () => {
        const out = formatReport([r('X1', 'BLOCKED', 'ALLOWED'), r('X2', 'BLOCKED', 'BLOCKED')], []);
        expect(out).toMatch(/OPEN X1/);
        expect(out).toMatch(/ok   X2/);
        expect(out).toMatch(/1 hole\(s\) still OPEN/);
    });

    it('says so when nothing is open', () => {
        expect(formatReport([r('X1', 'BLOCKED', 'BLOCKED')], [])).toMatch(/No holes found/);
    });

    it('warns when a legitimate action is blocked (lockdown went too far)', () => {
        expect(formatReport([r('L1', 'ALLOWED', 'BLOCKED')], [])).toMatch(/legitimate action\(s\) are BLOCKED/);
    });

    it('prints clean-up SQL for leftover rows, scoped so it never deletes a played match', () => {
        const out = formatReport([], ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
        expect(out).toContain("delete from public.matches where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')");
        expect(out).toContain('not exists (select 1 from public.rounds');
    });

    it('prints no clean-up SQL when nothing was left behind', () => {
        expect(formatReport([], [])).not.toContain('delete from');
    });
});

describe('cleanSecret', () => {
    it('removes the line break a token picks up when pasted across two lines', () => {
        expect(cleanSecret('eyJabc.def.ghi\n')).toBe('eyJabc.def.ghi');
        expect(cleanSecret('eyJabc.def.ghi\r\n')).toBe('eyJabc.def.ghi');
    });

    it('trims surrounding spaces and tabs', () => {
        expect(cleanSecret('   abc \t')).toBe('abc');
    });

    it('strips one pair of wrapping quotes, even around a pasted line break', () => {
        expect(cleanSecret('"abc"')).toBe('abc');
        expect(cleanSecret("'abc'")).toBe('abc');
        expect(cleanSecret('"abc\n"')).toBe('abc');
    });

    it('leaves a mismatched or inner quote alone', () => {
        expect(cleanSecret('"abc')).toBe('"abc');
        expect(cleanSecret('abc"')).toBe('abc"');
        expect(cleanSecret('a"b')).toBe('a"b');
        expect(cleanSecret('"abc\'')).toBe('"abc\'');
    });

    it('treats empty and whitespace-only input as missing', () => {
        expect(cleanSecret(undefined)).toBeUndefined();
        expect(cleanSecret('')).toBeUndefined();
        expect(cleanSecret(' \n ')).toBeUndefined();
        expect(cleanSecret('""')).toBeUndefined();
    });

    it('does not alter the characters inside a real token', () => {
        const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig-_x';
        expect(cleanSecret(jwt)).toBe(jwt);
    });
});

describe('describeToken', () => {
    const NOW = Date.UTC(2026, 9, 22, 18, 18, 0);
    const jwt = (payload: Record<string, unknown>) => fakeJwt(payload);

    it('reads the email and expiry of a token that is still valid', () => {
        const d = describeToken(jwt({ email: 'a@x.app', exp: NOW / 1000 + 600 }), NOW);
        expect(d).toEqual({ email: 'a@x.app', expiresAt: new Date(NOW + 600_000), expired: false });
    });

    it('reports an expired token, with the account it belonged to', () => {
        const d = describeToken(jwt({ email: 'test_b_01@players.countdown.app', exp: NOW / 1000 - 300 }), NOW);
        expect(d.expired).toBe(true);
        expect(d.email).toBe('test_b_01@players.countdown.app');
        expect(d.expiresAt?.toISOString()).toBe('2026-10-22T18:13:00.000Z');
    });

    it('a token expiring exactly now counts as expired', () => {
        expect(describeToken(jwt({ exp: NOW / 1000 }), NOW).expired).toBe(true);
    });

    it('never throws and never claims "expired" for something it cannot read', () => {
        for (const junk of ['', 'abc', 'a.b.c', 'a..c', '.', 'not a token at all']) {
            expect(describeToken(junk, NOW)).toEqual({ expired: false });
        }
    });

    it('ignores a missing or non-numeric exp and a non-string email', () => {
        expect(describeToken(jwt({ email: 42, exp: 'soon' }), NOW)).toEqual({ email: undefined, expiresAt: undefined, expired: false });
    });
});
