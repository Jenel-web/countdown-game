/**
 * Tests for scripts/get-token.ts: the password must come from SIM_PASSWORD and
 * a password on the command line must be refused BEFORE anything is sent.
 *
 * Two levels:
 *   - readCredentials(), the pure decision, tested directly;
 *   - the real script, run as a child process against a fake Supabase auth
 *     endpoint on 127.0.0.1 that records every request it receives, to prove
 *     which password actually goes over the wire (and that a refused run sends
 *     nothing at all).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { resolve } from 'path';
import { ARGV_PASSWORD_REFUSAL, USAGE, readCredentials } from '../../scripts/get-token';

const ENV = { SIM_PASSWORD: 'from-env-Pa55!', SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon' };

describe('readCredentials', () => {
    it('takes the password from SIM_PASSWORD', () => {
        const r = readCredentials(['alice'], ENV);
        expect(r).toEqual({
            ok: true,
            credentials: {
                email: 'alice@players.countdown.app',
                password: 'from-env-Pa55!',
                supabaseUrl: ENV.SUPABASE_URL,
                anonKey: 'anon',
            },
        });
    });

    it('refuses a password passed as an argument', () => {
        expect(readCredentials(['alice', 'hunter2'], {})).toEqual({ ok: false, message: ARGV_PASSWORD_REFUSAL });
    });

    it('refuses an argument password even when SIM_PASSWORD is also set (it has already leaked)', () => {
        expect(readCredentials(['alice', 'hunter2'], ENV)).toEqual({ ok: false, message: ARGV_PASSWORD_REFUSAL });
    });

    it.each([
        [['alice', '']], // an empty second argument is still a second argument
        [['alice', 'a', 'b']],
        [['alice', '--password=hunter2']],
    ])('refuses any extra argument: %j', (args) => {
        expect(readCredentials(args, ENV)).toEqual({ ok: false, message: ARGV_PASSWORD_REFUSAL });
    });

    it('the refusal message never contains the password that was typed', () => {
        const r = readCredentials(['alice', 'hunter2-secret'], ENV);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).not.toContain('hunter2-secret');
    });

    it.each([
        ['no identifier', [], ENV],
        ['SIM_PASSWORD missing', ['alice'], { ...ENV, SIM_PASSWORD: undefined }],
        ['SIM_PASSWORD empty', ['alice'], { ...ENV, SIM_PASSWORD: '' }],
        ['SUPABASE_URL missing', ['alice'], { ...ENV, SUPABASE_URL: undefined }],
        ['SUPABASE_ANON_KEY missing', ['alice'], { ...ENV, SUPABASE_ANON_KEY: undefined }],
    ])('prints usage when %s', (_label, args, env) => {
        expect(readCredentials(args as string[], env)).toEqual({ ok: false, message: USAGE });
    });

    it('an email identifier is used as-is', () => {
        const r = readCredentials(['someone@example.com'], ENV);
        expect(r.ok && r.credentials.email).toBe('someone@example.com');
    });

    it('the password is passed through exactly (no trimming or rewriting)', () => {
        const pw = '  spaces, "quotes", $dollars & ünïcode  ';
        const r = readCredentials(['alice'], { ...ENV, SIM_PASSWORD: pw });
        expect(r.ok && r.credentials.password).toBe(pw);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The real script, end to end
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = resolve(__dirname, '../../scripts/get-token.ts');
const TSX_CLI = resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
const GOOD_PASSWORD = 'correct-horse-battery';
const FAKE_TOKEN = 'fake-access-token-123';

interface AuthRequest {
    url: string;
    body: { email?: string; password?: string };
}

let authServer: Server;
let authUrl: string;
let requests: AuthRequest[] = [];

beforeAll(async () => {
    // Stands in for Supabase's /auth/v1/token?grant_type=password endpoint.
    authServer = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            let body: AuthRequest['body'] = {};
            try {
                body = JSON.parse(raw || '{}');
            } catch {
                /* recorded as empty */
            }
            requests.push({ url: req.url ?? '', body });
            res.setHeader('content-type', 'application/json');
            if (req.url?.startsWith('/auth/v1/token') && body.password === GOOD_PASSWORD) {
                res.writeHead(200).end(
                    JSON.stringify({
                        access_token: FAKE_TOKEN,
                        token_type: 'bearer',
                        expires_in: 3600,
                        expires_at: Math.floor(Date.now() / 1000) + 3600,
                        refresh_token: 'fake-refresh',
                        user: {
                            id: '00000000-0000-0000-0000-000000000001',
                            aud: 'authenticated',
                            role: 'authenticated',
                            email: body.email,
                            app_metadata: {},
                            user_metadata: {},
                            created_at: new Date().toISOString(),
                        },
                    })
                );
            } else {
                res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }));
            }
        });
    });
    await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
    authUrl = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((r) => authServer.close(() => r()));
});

beforeEach(() => {
    requests = [];
});

/** Runs the real CLI with ONLY the given variables set (nothing inherited from this shell's Supabase config). */
function runCli(args: string[], extraEnv: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ['SIM_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) delete env[k];
    Object.assign(env, extraEnv);

    return new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [TSX_CLI, SCRIPT, ...args], { env, cwd: resolve(__dirname, '../..') });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    });
}

describe('get-token CLI (real process, fake Supabase)', () => {
    const base = () => ({ SUPABASE_URL: authUrl, SUPABASE_ANON_KEY: 'anon' });

    it('signs in with SIM_PASSWORD and prints only the access token', async () => {
        const r = await runCli(['alice'], { ...base(), SIM_PASSWORD: GOOD_PASSWORD });

        expect(r.code).toBe(0);
        expect(r.stdout.trim()).toBe(FAKE_TOKEN);
        expect(r.stdout).not.toContain(GOOD_PASSWORD);
        // What actually went over the wire:
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toMatch(/^\/auth\/v1\/token\?grant_type=password/);
        expect(requests[0].body.password).toBe(GOOD_PASSWORD);
        expect(requests[0].body.email).toBe('alice@players.countdown.app');
    }, 30_000);

    it('a password on the command line is refused and NOTHING is sent to Supabase', async () => {
        const r = await runCli(['alice', GOOD_PASSWORD], base());

        expect(r.code).toBe(2);
        expect(r.stderr).toContain('Set SIM_PASSWORD instead');
        expect(r.stdout).toBe('');
        expect(r.stderr).not.toContain(GOOD_PASSWORD); // not echoed back either
        expect(requests).toHaveLength(0);
    }, 30_000);

    it('still refused when SIM_PASSWORD is ALSO set: the argument is not silently ignored', async () => {
        const r = await runCli(['alice', 'typed-in-shell'], { ...base(), SIM_PASSWORD: GOOD_PASSWORD });

        expect(r.code).toBe(2);
        expect(r.stdout).toBe('');
        expect(requests).toHaveLength(0);
    }, 30_000);

    it('without SIM_PASSWORD it prints usage and sends nothing', async () => {
        const r = await runCli(['alice'], base());

        expect(r.code).toBe(2);
        expect(r.stderr).toContain('SIM_PASSWORD=');
        expect(requests).toHaveLength(0);
    }, 30_000);

    it('a wrong SIM_PASSWORD fails cleanly: exit 1, no token, password not printed', async () => {
        const r = await runCli(['alice'], { ...base(), SIM_PASSWORD: 'wrong-password-xyz' });

        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/Sign-in failed/);
        expect(r.stdout).toBe('');
        expect(r.stdout + r.stderr).not.toContain('wrong-password-xyz');
        expect(requests).toHaveLength(1);
        expect(requests[0].body.password).toBe('wrong-password-xyz');
    }, 30_000);
});
