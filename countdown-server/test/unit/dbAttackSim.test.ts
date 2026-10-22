/**
 * Tests for the pure parts of scripts/db-attack-sim.ts: the key check that keeps
 * a policy-bypassing key out of the script, and the report. (The checks
 * themselves run against a real Supabase project and are run by hand.)
 */

import { describe, it, expect } from 'vitest';
import { assertPublicKey, formatReport, type CheckResult } from '../../scripts/db-attack-sim';

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
