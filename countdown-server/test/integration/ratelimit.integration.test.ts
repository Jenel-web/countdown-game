/**
 * =============================================================================
 * FILE: test/integration/ratelimit.integration.test.ts
 * DoS-protection tests against the real Socket.io server (same middleware chain
 * as src/index.ts), with the in-memory Supabase fake. Each test starts its own
 * server so limits can be set small and one test's traffic can't leak into the
 * next.
 *
 * Baseline measured BEFORE the limiter existed (same flood, no protection):
 *   500 join_room events        -> 500 processed (500 DB lookups in production)
 *   60 sockets, one account/IP  -> 60 accepted (60 Supabase auth calls)
 *   20 x 900KB packets          -> all swallowed, connection stayed open
 * =============================================================================
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMockAdminClient, type MockAdminClient } from './helpers/mockAdminClient';

vi.mock('../../src/supabase/adminClient', () => ({
    adminClient: createMockAdminClient(),
}));

import { adminClient } from '../../src/supabase/adminClient';
const mockAdmin = adminClient as unknown as MockAdminClient;

import type { TestServerHandle, TestServerOptions } from './helpers/testServer';
import { createTestClient, waitForEvent, type TestClientSocket } from './helpers/testClient';
import type { Tile } from '../../src/types/events';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sockets: TestClientSocket[] = [];
const servers: TestServerHandle[] = [];

afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    for (const srv of servers.splice(0)) await srv.close();
    vi.restoreAllMocks();
});

async function newServer(options: TestServerOptions = {}): Promise<TestServerHandle> {
    const { startTestServer } = await import('./helpers/testServer');
    const srv = await startTestServer(options);
    servers.push(srv);
    return srv;
}

/** Resolves when the connection is accepted OR refused. */
function tryConnect(url: string, userId: string): Promise<{ ok: boolean; message?: string; socket: TestClientSocket }> {
    const socket = createTestClient(url, userId);
    sockets.push(socket);
    return new Promise((resolve) => {
        socket.once('connect', () => resolve({ ok: true, socket }));
        socket.once('connect_error', (err) => resolve({ ok: false, message: err.message, socket }));
    });
}

async function connectOk(url: string, userId: string): Promise<TestClientSocket> {
    const r = await tryConnect(url, userId);
    if (!r.ok) throw new Error(`expected ${userId} to connect: ${r.message}`);
    return r.socket;
}

function collect<T = any>(socket: TestClientSocket, event: string): T[] {
    const seen: T[] = [];
    (socket as any).on(event, (p: T) => seen.push(p));
    return seen;
}

const closedPromise = (s: TestClientSocket) => new Promise<void>((res) => s.once('disconnect', () => res()));

// ═══════════════════════════════════════════════════════════════════════════

describe('packet flooding on one connection', () => {
    it('500 join_room events: only a handful are processed (each would be a DB lookup), then the socket is cut off', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'flooder');
        const replies = collect(c, 'error');
        const closed = closedPromise(c);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        for (let i = 0; i < 500; i++) (c as any).emit('join_room', { matchId: `m${i}` });
        await Promise.race([closed, sleep(4000)]);

        expect(replies.length).toBeLessThanOrEqual(8); // was 500 with no limiter
        expect(c.connected).toBe(false);
    });

    it('flooding with made-up event names is cut off too', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'noise');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const closed = closedPromise(c);
        for (let i = 0; i < 400; i++) (c as any).emit(`junk_${i}`, { x: i });
        await Promise.race([closed, sleep(4000)]);
        expect(c.connected).toBe(false);
    });

    it('a normal player never trips the limits: reconnect-style rejoins, rapid tile clicks, and a submit', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'normal-player');
        const matchId = randomUUID();
        mockAdmin.__state.matches.push({ id: matchId, player1_id: 'normal-player', player2_id: null, status: 'pending', winner_id: null });

        const waiting = collect(c, 'waiting_for_opponent');
        for (let i = 0; i < 3; i++) c.emit('join_room', { matchId }); // refresh/reconnect storm
        for (let i = 0; i < 15; i++) (c as any).emit('player_status', { status: 'thinking' }); // frantic clicking
        await sleep(300);

        expect(c.connected).toBe(true);
        expect(waiting.length).toBeGreaterThanOrEqual(3);
    });

    it('the limit is per socket: one flooder does not throttle another player', async () => {
        const srv = await newServer();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const flooder = await connectOk(srv.url, 'bad');
        const bystander = await connectOk(srv.url, 'good');
        const replies = collect(bystander, 'error');

        for (let i = 0; i < 300; i++) (flooder as any).emit('join_room', { matchId: `m${i}` });
        (bystander as any).emit('join_room', { matchId: 'nope' });
        await sleep(400);

        expect(replies.length).toBe(1); // the bystander's single request was answered normally
        expect(bystander.connected).toBe(true);
    });
});

describe('oversized packets', () => {
    it('a packet over the size cap closes the connection and is never parsed into a handler', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'fat-finger');
        const closed = closedPromise(c);
        (c as any).emit('submit_answer', { steps: [], junk: 'x'.repeat(50_000) });
        await Promise.race([closed, sleep(3000)]);
        expect(c.connected).toBe(false);
    });

    it('a 5MB packet is refused the same way (the baseline accepted 900KB x 20)', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'huge');
        const closed = closedPromise(c);
        (c as any).emit('player_status', { status: 'thinking', junk: 'x'.repeat(5_000_000) });
        await Promise.race([closed, sleep(3000)]);
        expect(c.connected).toBe(false);
    });

    it('an ordinary-sized submission is far under the cap and still works', async () => {
        const srv = await newServer();
        const c = await connectOk(srv.url, 'ok-size');
        const errors = collect<{ code: string }>(c, 'error');
        c.emit('submit_answer', { steps: [{ a: 1, op: '+', b: 2, result: 3 }], resultValue: 3 });
        await waitForEvent(c, 'error'); // not_in_room: answered, i.e. delivered
        expect(errors[0].code).toBe('not_in_room');
        expect(c.connected).toBe(true);
    });
});

describe('connection floods', () => {
    it('per IP: after the burst allowance new connections are refused WITHOUT calling Supabase auth', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const authCalls = vi.spyOn(mockAdmin.auth, 'getUser');
        const srv = await newServer({ ipLimit: { capacity: 5, refillPerSec: 0 } });

        const results = [];
        for (let i = 0; i < 12; i++) results.push(await tryConnect(srv.url, `ip-user-${i}`)); // 12 different accounts, one IP

        expect(results.filter((r) => r.ok)).toHaveLength(5);
        const refused = results.filter((r) => !r.ok);
        expect(refused).toHaveLength(7);
        expect(refused.every((r) => /too many connection attempts/i.test(r.message ?? ''))).toBe(true);
        // The whole point of running before auth: refused attempts cost nothing downstream.
        expect(authCalls).toHaveBeenCalledTimes(5);
    });

    it('per account: sockets beyond the cap are refused, other accounts are unaffected, and a slot frees up when one closes', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const srv = await newServer({ maxSocketsPerUser: 3 });

        const a = await tryConnect(srv.url, 'one-account');
        const b = await tryConnect(srv.url, 'one-account');
        const c = await tryConnect(srv.url, 'one-account');
        const d = await tryConnect(srv.url, 'one-account');
        const e = await tryConnect(srv.url, 'one-account');
        expect([a.ok, b.ok, c.ok, d.ok, e.ok]).toEqual([true, true, true, false, false]);
        expect(d.message).toMatch(/too many open connections/i);

        // Another account is unaffected...
        expect((await tryConnect(srv.url, 'someone-else')).ok).toBe(true);

        // ...and closing one socket makes room again.
        a.socket.disconnect();
        await sleep(100);
        expect((await tryConnect(srv.url, 'one-account')).ok).toBe(true);
    });

    it('60 CONCURRENT sockets from one account: exactly the cap get in (the baseline accepted all 60)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const srv = await newServer({ maxSocketsPerUser: 5 });
        const attempts = await Promise.all(Array.from({ length: 60 }, () => tryConnect(srv.url, 'sock-farm')));
        expect(attempts.filter((r) => r.ok)).toHaveLength(5);
        expect(srv.heldConnections('sock-farm')).toBe(5);
        expect((await tryConnect(srv.url, 'sock-farm')).ok).toBe(false);
    });

    it('a slow auth does not let concurrent handshakes slip past the cap', async () => {
        // The race the old cap lost: every handshake is parked in the auth await at the same time.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realGetUser = mockAdmin.auth.getUser.bind(mockAdmin.auth);
        vi.spyOn(mockAdmin.auth, 'getUser').mockImplementation(async (token: string) => {
            await sleep(150);
            return realGetUser(token);
        });
        const srv = await newServer({ maxSocketsPerUser: 3 });
        const attempts = await Promise.all(Array.from({ length: 20 }, () => tryConnect(srv.url, 'slow-auth')));
        expect(attempts.filter((r) => r.ok)).toHaveLength(3);
    });

    it('handshakes abandoned while auth is in flight do not leak slots', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realGetUser = mockAdmin.auth.getUser.bind(mockAdmin.auth);
        vi.spyOn(mockAdmin.auth, 'getUser').mockImplementation(async (token: string) => {
            await sleep(200);
            return realGetUser(token);
        });
        const srv = await newServer({ maxSocketsPerUser: 2 });

        // Open 6 connections and walk away from each one before auth answers.
        for (let i = 0; i < 6; i++) {
            const s = createTestClient(srv.url, 'quitter');
            sockets.push(s);
            await sleep(20);
            s.disconnect();
        }
        await sleep(400); // all the parked handshakes resolve now
        expect(srv.heldConnections('quitter')).toBe(0);

        // The account can still use its full allowance.
        const a = await tryConnect(srv.url, 'quitter');
        const b = await tryConnect(srv.url, 'quitter');
        expect([a.ok, b.ok]).toEqual([true, true]);
    });

    it('slots are returned when sockets close, so the account can reconnect afterwards', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const srv = await newServer({ maxSocketsPerUser: 2 });
        const a = await tryConnect(srv.url, 'cycler');
        const b = await tryConnect(srv.url, 'cycler');
        expect(srv.heldConnections('cycler')).toBe(2);

        a.socket.disconnect();
        b.socket.disconnect();
        const deadline = Date.now() + 2000;
        while (srv.heldConnections('cycler') > 0 && Date.now() < deadline) await sleep(20);
        expect(srv.heldConnections('cycler')).toBe(0);
        expect((await tryConnect(srv.url, 'cycler')).ok).toBe(true);
    });
});

describe('an attack does not hurt a live match', () => {
    async function startMatch(srv: TestServerHandle, u1: string, u2: string) {
        const matchId = randomUUID();
        mockAdmin.__state.matches.push({ id: matchId, player1_id: u1, player2_id: null, status: 'pending', winner_id: null });
        const c1 = await connectOk(srv.url, u1);
        const c2 = await connectOk(srv.url, u2);
        c1.emit('join_room', { matchId });
        await waitForEvent(c1, 'waiting_for_opponent');
        const rs1 = waitForEvent<{ tiles: Tile[] }>(c1, 'round_start', 8000);
        const rs2 = waitForEvent(c2, 'round_start', 8000);
        c2.emit('join_room', { matchId });
        const [r] = await Promise.all([rs1, rs2]);
        return { matchId, c1, c2, tiles: r.tiles };
    }

    it('while an outsider floods the server, a running match still scores promptly', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const srv = await newServer();
        const { c1, c2, tiles } = await startMatch(srv, 'live-1', 'live-2');

        const attacker = await connectOk(srv.url, 'attacker');
        const result = waitForEvent<any>(c1, 'round_result', 3000);
        for (let i = 0; i < 2000; i++) (attacker as any).emit('join_room', { matchId: `x${i}` });

        const [a, b] = tiles;
        const sum = a.value + b.value;
        const t0 = Date.now();
        c1.emit('submit_answer', { steps: [{ a: a.value, op: '+', b: b.value, result: sum }], resultValue: sum });
        c2.emit('submit_answer', { steps: [{ a: a.value, op: '+', b: b.value, result: sum }], resultValue: sum });
        const rr = await result;

        expect(Date.now() - t0).toBeLessThan(2000);
        expect(rr.player1.result).toBe(sum);
        expect(c1.connected && c2.connected).toBe(true);
    });

    it('a player who floods mid-match is cut off and, after the normal grace period, forfeits', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const srv = await newServer();
        const { matchId, c1, c2 } = await startMatch(srv, 'flood-p1', 'flood-p2');
        const left = collect(c2, 'opponent_left');
        const closed = closedPromise(c1);

        for (let i = 0; i < 500; i++) (c1 as any).emit('player_status', { status: 'thinking' });
        await Promise.race([closed, sleep(4000)]);
        expect(c1.connected).toBe(false);

        const deadline = Date.now() + 3000;
        while (left.length === 0 && Date.now() < deadline) await sleep(25);
        expect(left).toHaveLength(1);
        const calls = mockAdmin.__state.finishMatchCalls.filter((c) => c.p_match_id === matchId);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ p_winner_id: 'flood-p2', p_loser_id: 'flood-p1' });
    });
});
