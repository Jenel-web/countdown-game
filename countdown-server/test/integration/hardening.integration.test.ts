/**
 * =============================================================================
 * FILE: test/integration/hardening.integration.test.ts
 * Regression tests for the multiplayer-integrity fixes, run against the real
 * Socket.io server with real socket.io-client connections and the in-memory
 * Supabase fake. Each block is an attack or a nasty edge case that used to work:
 *
 *   1. malformed / hostile payloads must never crash or stall the server
 *   2. forged submissions must score as "no answer", never as a win
 *   3. a round is scored exactly once (replays, double clicks, concurrency)
 *   4. submissions outside the round window are refused
 *   5. cancel_room cannot erase / reopen a live or finished match
 *   6. request_rematch only works once a match is over
 *
 * Plus the legitimate paths that must keep working next to each fix.
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMockAdminClient, type MockAdminClient } from './helpers/mockAdminClient';

vi.mock('../../src/supabase/adminClient', () => ({
    adminClient: createMockAdminClient(),
}));

import { adminClient } from '../../src/supabase/adminClient';
const mockAdmin = adminClient as unknown as MockAdminClient;

import { type TestServerHandle } from './helpers/testServer';
import {
    createTestClient,
    waitForConnect,
    waitForEvent,
    type TestClientSocket,
} from './helpers/testClient';
import type { Tile } from '../../src/types/events';

const ROUND_START_TIMEOUT = 8000;

let server: TestServerHandle;
const openSockets: TestClientSocket[] = [];

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);

beforeAll(async () => {
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
    const { startTestServer } = await import('./helpers/testServer');
    server = await startTestServer();
});

afterAll(async () => {
    process.removeListener('unhandledRejection', onUnhandled);
    process.removeListener('uncaughtException', onUnhandled);
    await server?.close();
});

afterEach(() => {
    for (const s of openSockets.splice(0)) s.disconnect();
});

// ── helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
        await sleep(10);
    }
}

async function connect(userId: string): Promise<TestClientSocket> {
    const s = createTestClient(server.url, userId);
    openSockets.push(s);
    await waitForConnect(s);
    return s;
}

/** Records every payload of `event` that `socket` receives from now on. */
function collect<T = any>(socket: TestClientSocket, event: string): T[] {
    const seen: T[] = [];
    (socket as any).on(event, (p: T) => seen.push(p));
    return seen;
}

function seedMatch(matchId: string, player1Id: string, status: 'pending' | 'completed' = 'pending', player2Id: string | null = null) {
    mockAdmin.__state.matches.push({
        id: matchId,
        player1_id: player1Id,
        player2_id: player2Id,
        status,
        winner_id: status === 'completed' ? player1Id : null,
    });
}

const rowOf = (matchId: string) => mockAdmin.__state.matches.find((m) => m.id === matchId);
const roundsOf = (matchId: string) => mockAdmin.__state.rounds.filter((r) => r.match_id === matchId);
const finishCallsFor = (matchId: string) => mockAdmin.__state.finishMatchCalls.filter((c) => c.p_match_id === matchId);

interface Started {
    matchId: string;
    c1: TestClientSocket;
    c2: TestClientSocket;
    tiles: Tile[];
}

/** Two players join and round 1 is in progress. */
async function startMatch(u1: string, u2: string): Promise<Started> {
    const matchId = randomUUID();
    seedMatch(matchId, u1);

    const c1 = await connect(u1);
    const c2 = await connect(u2);

    c1.emit('join_room', { matchId });
    await waitForEvent(c1, 'waiting_for_opponent');

    const rs1 = waitForEvent<{ tiles: Tile[] }>(c1, 'round_start', ROUND_START_TIMEOUT);
    const rs2 = waitForEvent<{ tiles: Tile[] }>(c2, 'round_start', ROUND_START_TIMEOUT);
    c2.emit('join_room', { matchId });
    const [r1] = await Promise.all([rs1, rs2]);
    return { matchId, c1, c2, tiles: r1.tiles };
}

/** Always-legal one-step answer: the first two tiles added. */
function validAdd(tiles: Tile[]) {
    const [a, b] = tiles;
    const result = a.value + b.value;
    return { steps: [{ a: a.value, op: '+' as const, b: b.value, result }], resultValue: result };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Malformed / hostile payloads
// ═══════════════════════════════════════════════════════════════════════════

describe('malformed payloads never crash or stall the server', () => {
    const garbage: unknown[] = [undefined, null, 'x', 42, true, [], [null], {}, { matchId: null }, { matchId: {} }, { matchId: ['a'] }];

    it('every event survives every garbage payload, and the server keeps serving real matches', async () => {
        const evil = await connect('evil-user');
        const errors = collect<{ code: string }>(evil, 'error');

        for (const payload of garbage) {
            for (const event of ['join_room', 'cancel_room', 'submit_answer', 'player_status', 'request_rematch', 'rematch_response']) {
                (evil as any).emit(event, payload);
            }
        }
        // Garbage that carries a plausible-looking id but nonsense steps
        for (const steps of [null, 'steps', { 0: 1 }, [null], [undefined], [1, 2, 3], [[]], [{}], 7]) {
            (evil as any).emit('submit_answer', { steps, resultValue: 1 });
        }
        await sleep(300);

        expect(evil.connected).toBe(true);
        expect(unhandled).toEqual([]);
        // join_room with a bad payload is answered like "no such match" - never silence, never a crash
        expect(errors.some((e) => e.code === 'not_found')).toBe(true);

        // And the server still runs a normal match afterwards.
        const { c1, c2 } = await startMatch('after-evil-1', 'after-evil-2');
        expect(c1.connected && c2.connected).toBe(true);
    });

    it('a player in a live round who sends garbage steps does not crash the server, and can still submit a real answer', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('garb-1', 'garb-2');

        for (const steps of [null, 'x', { length: 1 }, 7]) {
            (c1 as any).emit('submit_answer', { steps, resultValue: 3 });
        }
        (c1 as any).emit('submit_answer');
        (c1 as any).emit('submit_answer', null);
        await sleep(150);
        expect(unhandled).toEqual([]);

        // Malformed-SHAPE payloads are dropped without consuming the player's one submission...
        expect(server.roomManager.getRoom(matchId)!.submissions.player1).toBeUndefined();

        // ...so a real answer afterwards still counts.
        const result = waitForEvent<any>(c2, 'round_result');
        const add = validAdd(tiles);
        c1.emit('submit_answer', add);
        c2.emit('submit_answer', { steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], resultValue: 0 });
        const rr = await result;
        expect(rr.player1.result).toBe(add.resultValue);
    });

    it('an oversized steps array is dropped, not processed', async () => {
        const { c1, matchId } = await startMatch('big-1', 'big-2');
        const steps = Array.from({ length: 5000 }, () => ({ a: 1, op: '+' as const, b: 1, result: 2 }));
        c1.emit('submit_answer', { steps, resultValue: 2 });
        await sleep(150);
        expect(server.roomManager.getRoom(matchId)!.submissions.player1).toBeUndefined();
    });

    it('player_status only relays the two real statuses', async () => {
        const { c1, c2 } = await startMatch('stat-1', 'stat-2');
        const seen = collect<{ userId: string; status: string }>(c2, 'player_status');

        (c1 as any).emit('player_status', { status: 'thinking' });
        (c1 as any).emit('player_status', { status: '<script>alert(1)</script>' });
        (c1 as any).emit('player_status', { status: 'winner' });
        (c1 as any).emit('player_status', null);
        (c1 as any).emit('player_status');
        await sleep(150);

        expect(seen).toEqual([{ userId: 'stat-1', status: 'thinking' }]);
    });

    it('a join_room for an id that is not a match id is answered with not_found', async () => {
        const c = await connect('lost-user');
        const errors = collect<{ code: string }>(c, 'error');
        for (const matchId of ['', 'has space', "x'; drop table matches;--", 'a'.repeat(200), '../../etc/passwd']) {
            c.emit('join_room', { matchId });
        }
        await sleep(200);
        expect(errors).toHaveLength(5);
        expect(errors.every((e) => e.code === 'not_found')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Forged submissions score as "no answer"
// ═══════════════════════════════════════════════════════════════════════════

describe('forged submissions never beat an honest answer', () => {
    const forgeries: Array<[string, (t: Tile[]) => unknown]> = [
        ['unknown operator and no result field (the NaN exploit)', (t) => [{ a: t[0].value, op: '?', b: t[1].value }]],
        ['ASCII minus instead of U+2212', (t) => [{ a: t[0].value, op: '-', b: t[1].value, result: 1 }]],
        ['letter x instead of U+00D7', (t) => [{ a: t[0].value, op: 'x', b: t[1].value, result: t[0].value * t[1].value }]],
        ['slash instead of U+00F7', (t) => [{ a: t[0].value, op: '/', b: t[1].value, result: 1 }]],
        ['result sent as a string', (t) => [{ a: t[0].value, op: '+', b: t[1].value, result: String(t[0].value + t[1].value) }]],
        ['fractional result', (t) => [{ a: t[0].value, op: '+', b: t[1].value, result: t[0].value + t[1].value + 0.5 }]],
        ['wrong arithmetic (claims a bigger result)', (t) => [{ a: t[0].value, op: '+', b: t[1].value, result: t[0].value + t[1].value + 1 }]],
        ['null step', () => [null]],
        ['operands that are not in the pool', () => [{ a: 12345, op: '+', b: 1, result: 12346 }]],
        ['unsafe huge integers', () => [{ a: 2 ** 60, op: '+', b: 2 ** 60, result: 2 ** 61 }]],
        ['empty steps', () => []],
    ];

    it.each(forgeries)('%s', async (_label, build) => {
        const { c1, c2, tiles, matchId } = await startMatch('forger', 'honest');
        const result = waitForEvent<any>(c2, 'round_result');

        // The forger is FASTER (submits first) - the old exploit relied on speed.
        (c1 as any).emit('submit_answer', { steps: build(tiles), resultValue: 1 });
        c2.emit('submit_answer', validAdd(tiles));
        const rr = await result;

        expect(rr.player1.result).toBeNull();
        expect(rr.player1.pointsRaw).toBe(0);
        expect(rr.player1.outcome).toBe('loss');
        expect(rr.player2.pointsRaw).toBe(100);
        expect(Number.isNaN(rr.player1.pointsRaw) || Number.isNaN(rr.player2.pointsRaw)).toBe(false);

        const [row] = roundsOf(matchId);
        expect(row.player1_result).toBeNull();
        expect(row.player1_steps).toBeNull();
    });

    it('a forged submission burns that player\'s one submission for the round', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('burn-1', 'burn-2');
        (c1 as any).emit('submit_answer', { steps: [{ a: tiles[0].value, op: '?', b: tiles[1].value }], resultValue: 1 });
        await waitFor(() => !!server.roomManager.getRoom(matchId)!.submissions.player1);

        // Trying to "fix it" with a legal answer afterwards is ignored.
        const result = waitForEvent<any>(c2, 'round_result');
        c1.emit('submit_answer', validAdd(tiles));
        c2.emit('submit_answer', validAdd(tiles));
        const rr = await result;
        expect(rr.player1.result).toBeNull();
        expect(rr.player2.pointsRaw).toBe(100);
    });

    it('legit exact-vs-valid scoring is unchanged: both honest, closer wins', async () => {
        const { c1, c2, tiles } = await startMatch('honest-1', 'honest-2');
        const result = waitForEvent<any>(c1, 'round_result');
        const [a, b, c] = tiles;
        c1.emit('submit_answer', { steps: [{ a: a.value, op: '+' as const, b: b.value, result: a.value + b.value }], resultValue: 0 });
        c2.emit('submit_answer', {
            steps: [
                { a: a.value, op: '+' as const, b: b.value, result: a.value + b.value },
                { a: a.value + b.value, op: '+' as const, b: c.value, result: a.value + b.value + c.value },
            ],
            resultValue: 0,
        });
        const rr = await result;
        expect(rr.player1.result).toBe(a.value + b.value);
        expect(rr.player2.result).toBe(a.value + b.value + c.value);
        expect(rr.player1.pointsRaw + rr.player2.pointsRaw).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A round is scored exactly once
// ═══════════════════════════════════════════════════════════════════════════

describe('each round is scored exactly once', () => {
    it('spamming submit_answer right after round_result does not re-score the round', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('replay-1', 'replay-2');
        const results1 = collect<any>(c1, 'round_result');
        const results2 = collect<any>(c2, 'round_result');

        // The attack: the instant the result arrives, hammer submit_answer.
        const fire = () => {
            for (let i = 0; i < 20; i++) {
                c1.emit('submit_answer', validAdd(tiles));
                c2.emit('submit_answer', validAdd(tiles));
            }
        };
        c1.once('round_result', fire);

        c1.emit('submit_answer', validAdd(tiles));
        c2.emit('submit_answer', { steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], resultValue: 0 });
        await waitFor(() => results1.length >= 1 && results2.length >= 1);
        await sleep(400);

        // Round 1 appears exactly once on each client, with the single-scoring totals.
        expect(results1.filter((r) => r.roundNumber === 1)).toHaveLength(1);
        expect(results2.filter((r) => r.roundNumber === 1)).toHaveLength(1);
        expect(results1[0].player1TotalRaw).toBe(100);

        // And exactly one persisted row per round number.
        const nums = roundsOf(matchId).map((r) => r.round_number);
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums.filter((n) => n === 1)).toHaveLength(1);
        expect(unhandled).toEqual([]);
    });

    it('a submit while the round is being scored is refused with no_active_round and records nothing', async () => {
        const { c1, tiles, matchId } = await startMatch('eval-1', 'eval-2');
        const errors = collect<{ code: string }>(c1, 'error');

        // Simulates the window where the timer / "both submitted" is mid-await.
        expect(server.roomManager.beginEvaluation(matchId)).toBe(true);

        c1.emit('submit_answer', validAdd(tiles));
        await waitFor(() => errors.length > 0);
        expect(errors[0].code).toBe('no_active_round');
        expect(server.roomManager.getRoom(matchId)!.submissions.player1).toBeUndefined();
    });

    it('a double-click: the second submit is ignored and the first answer is the one scored', async () => {
        const { c1, c2, tiles } = await startMatch('dbl-1', 'dbl-2');
        const results = collect<any>(c1, 'round_result');
        const [a, b, c] = tiles;

        const first = { steps: [{ a: a.value, op: '+' as const, b: b.value, result: a.value + b.value }], resultValue: 0 };
        const second = {
            steps: [
                { a: a.value, op: '+' as const, b: b.value, result: a.value + b.value },
                { a: a.value + b.value, op: '+' as const, b: c.value, result: a.value + b.value + c.value },
            ],
            resultValue: 0,
        };
        c1.emit('submit_answer', first);
        c1.emit('submit_answer', second);
        await sleep(100);
        expect(results).toHaveLength(0); // one player's repeats must not look like "both submitted"

        c2.emit('submit_answer', first);
        await waitFor(() => results.length === 1);
        expect(results[0].player1.result).toBe(a.value + b.value);
    });

    it('both players submitting (with duplicates) in the same instant yields one result and one DB row', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('race-1', 'race-2');
        const r1 = collect<any>(c1, 'round_result');
        const r2 = collect<any>(c2, 'round_result');

        for (let i = 0; i < 5; i++) {
            c1.emit('submit_answer', validAdd(tiles));
            c2.emit('submit_answer', validAdd(tiles));
        }
        await waitFor(() => r1.length >= 1 && r2.length >= 1);
        await sleep(300);

        expect(r1.filter((r) => r.roundNumber === 1)).toHaveLength(1);
        expect(r2.filter((r) => r.roundNumber === 1)).toHaveLength(1);
        expect(roundsOf(matchId).filter((r) => r.round_number === 1)).toHaveLength(1);
    });

    it('submitting after the match is over is refused and never writes anything', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('over-1', 'over-2');
        server.roomManager.getRoom(matchId)!.player1TotalRaw = 450;

        const over = waitForEvent<any>(c1, 'match_over');
        c1.emit('submit_answer', validAdd(tiles));
        c2.emit('submit_answer', { steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], resultValue: 0 });
        await over;

        const errors = collect<{ code: string }>(c1, 'error');
        const rowsBefore = roundsOf(matchId).length;
        for (let i = 0; i < 10; i++) c1.emit('submit_answer', validAdd(tiles));
        await sleep(250);

        expect(errors.every((e) => e.code === 'no_active_round')).toBe(true);
        expect(errors.length).toBeGreaterThan(0);
        expect(roundsOf(matchId)).toHaveLength(rowsBefore);
        expect(finishCallsFor(matchId)).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Submission timing
// ═══════════════════════════════════════════════════════════════════════════

describe('submission window', () => {
    it('is refused during the prep countdown (before gameplay starts)', async () => {
        const { c1, tiles, matchId } = await startMatch('early-1', 'early-2');
        const errors = collect<{ code: string }>(c1, 'error');

        server.roomManager.getRoom(matchId)!.startTimestamp = Date.now() + 5_000; // 5s of prep still to go
        c1.emit('submit_answer', validAdd(tiles));
        await waitFor(() => errors.length > 0);

        expect(errors[0].code).toBe('no_active_round');
        expect(server.roomManager.getRoom(matchId)!.submissions.player1).toBeUndefined();

        // A refused early attempt does not burn the slot: once the round starts, it works.
        server.roomManager.getRoom(matchId)!.startTimestamp = Date.now() - 10;
        c1.emit('submit_answer', validAdd(tiles));
        await waitFor(() => !!server.roomManager.getRoom(matchId)?.submissions.player1);
    });

    it('allows a small clock-skew allowance, and the recorded time is never negative', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('skew-1', 'skew-2');

        server.roomManager.getRoom(matchId)!.startTimestamp = Date.now() + 400; // client clock slightly ahead
        const result = waitForEvent<any>(c1, 'round_result');
        c1.emit('submit_answer', validAdd(tiles));
        c2.emit('submit_answer', validAdd(tiles));
        const rr = await result;

        expect(rr.player1.timeMs).toBeGreaterThanOrEqual(0);
        expect(rr.player2.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('a stranger who never joined the room cannot submit', async () => {
        const { matchId, tiles } = await startMatch('room-a', 'room-b');
        const stranger = await connect('stranger');
        const errors = collect<{ code: string }>(stranger, 'error');
        stranger.emit('submit_answer', validAdd(tiles));
        await waitFor(() => errors.length > 0);
        expect(errors[0].code).toBe('not_in_room');
        expect(server.roomManager.getRoom(matchId)!.submissions).toEqual({});
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. cancel_room
// ═══════════════════════════════════════════════════════════════════════════

describe('cancel_room', () => {
    it('LEGIT: the host can still cancel a match that has not started', async () => {
        const matchId = randomUUID();
        seedMatch(matchId, 'host-w');
        const host = await connect('host-w');
        host.emit('join_room', { matchId });
        await waitForEvent(host, 'waiting_for_opponent');

        host.emit('cancel_room', { matchId });
        await waitFor(() => !rowOf(matchId));
        expect(server.roomManager.getRoom(matchId)).toBeUndefined();
    });

    it('a losing HOST cannot erase a live match: row and room survive, and leaving still forfeits', async () => {
        const { matchId, c1, c2 } = await startMatch('cancel-host', 'cancel-guest');
        const left = collect(c2, 'opponent_left');

        c1.emit('cancel_room', { matchId });
        await sleep(250);

        expect(rowOf(matchId)?.status).toBe('active');
        expect(rowOf(matchId)?.player2_id).toBe('cancel-guest');
        expect(server.roomManager.getRoom(matchId)).toBeDefined();

        // The only way out is to leave - and that is a loss on the record.
        c1.disconnect();
        await waitFor(() => left.length > 0);
        await waitFor(() => finishCallsFor(matchId).length === 1);
        expect(finishCallsFor(matchId)[0]).toMatchObject({ p_winner_id: 'cancel-guest', p_loser_id: 'cancel-host' });
        expect(rowOf(matchId)?.status).toBe('completed');
    });

    it('a losing GUEST cannot reset a live match back to pending either', async () => {
        const { matchId, c2 } = await startMatch('guest-c1', 'guest-c2');

        c2.emit('cancel_room', { matchId });
        await sleep(250);

        expect(rowOf(matchId)?.status).toBe('active');
        expect(rowOf(matchId)?.player2_id).toBe('guest-c2');
        expect(server.roomManager.getRoom(matchId)!.player2Id).toBe('guest-c2');
    });

    it('cannot reopen or delete a COMPLETED match (no live room)', async () => {
        const matchId = randomUUID();
        seedMatch(matchId, 'done-1', 'completed', 'done-2');
        const p1 = await connect('done-1');
        const p2 = await connect('done-2');

        p1.emit('cancel_room', { matchId });
        p2.emit('cancel_room', { matchId });
        await sleep(250);

        expect(rowOf(matchId)).toMatchObject({ status: 'completed', player1_id: 'done-1', player2_id: 'done-2', winner_id: 'done-1' });
    });

    it('cancel_room for a DIFFERENT match id does not make the server forget the caller\'s real match', async () => {
        const { c1, c2, matchId } = await startMatch('track-1', 'track-2');
        const left = collect(c2, 'opponent_left');

        c1.emit('cancel_room', { matchId: 'some-other-match' });
        await sleep(100);
        c1.disconnect();

        // If matchId tracking had been wiped, the disconnect would be ignored and nobody would forfeit.
        await waitFor(() => left.length > 0);
        await waitFor(() => finishCallsFor(matchId).length === 1);
        expect(finishCallsFor(matchId)[0].p_loser_id).toBe('track-1');
    });

    it('a stranger cannot cancel somebody else\'s waiting room', async () => {
        const matchId = randomUUID();
        seedMatch(matchId, 'owner');
        const owner = await connect('owner');
        owner.emit('join_room', { matchId });
        await waitForEvent(owner, 'waiting_for_opponent');

        const stranger = await connect('not-the-owner');
        stranger.emit('cancel_room', { matchId });
        await sleep(250);

        expect(rowOf(matchId)).toBeDefined();
        expect(server.roomManager.getRoom(matchId)).toBeDefined();
    });

    it('cancel_room on an id that does not exist is a harmless no-op', async () => {
        const c = await connect('nobody');
        c.emit('cancel_room', { matchId: randomUUID() });
        await sleep(100);
        expect(c.connected).toBe(true);
        expect(unhandled).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Rematch
// ═══════════════════════════════════════════════════════════════════════════

describe('request_rematch', () => {
    it('is ignored while the match is still live (no mid-game offers)', async () => {
        const { c1, c2, matchId } = await startMatch('rm-live-1', 'rm-live-2');
        const offers = collect(c2, 'rematch_offer');
        const declined = collect(c1, 'rematch_declined');

        c1.emit('request_rematch', { matchId });
        await sleep(250);

        expect(offers).toHaveLength(0);
        expect(declined).toHaveLength(0);
        expect(server.roomManager.getRoom(matchId)).toBeDefined();
    });

    it('works after the match is over: offer -> accept -> new match row; outsiders and self-accept are ignored', async () => {
        const { c1, c2, tiles, matchId } = await startMatch('rm-a', 'rm-b');
        server.roomManager.getRoom(matchId)!.player1TotalRaw = 450;

        const over = waitForEvent<any>(c1, 'match_over');
        c1.emit('submit_answer', validAdd(tiles));
        c2.emit('submit_answer', { steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], resultValue: 0 });
        await over;
        expect(server.roomManager.getRoom(matchId)).toBeUndefined();

        const offers2 = collect(c2, 'rematch_offer');
        const accepted1 = collect<{ newMatchId: string }>(c1, 'rematch_accepted');
        const accepted2 = collect<{ newMatchId: string }>(c2, 'rematch_accepted');

        // An outsider who never played this match cannot start one.
        const outsider = await connect('rm-outsider');
        outsider.emit('request_rematch', { matchId });
        await sleep(100);
        expect(offers2).toHaveLength(0);

        // The real requester can.
        c1.emit('request_rematch', { matchId });
        await waitFor(() => offers2.length === 1);

        // The requester cannot accept their own offer.
        (c1 as any).emit('rematch_response', { matchId, accepted: true });
        // Garbage responses are dropped.
        (c2 as any).emit('rematch_response', { matchId, accepted: 'yes' });
        (c2 as any).emit('rematch_response', null);
        await sleep(150);
        expect(accepted1).toHaveLength(0);
        expect(accepted2).toHaveLength(0);

        // The opponent accepts.
        c2.emit('rematch_response', { matchId, accepted: true });
        await waitFor(() => accepted1.length === 1 && accepted2.length === 1);
        expect(accepted1[0].newMatchId).toBe(accepted2[0].newMatchId);

        const newRow = rowOf(accepted1[0].newMatchId);
        expect(newRow).toMatchObject({ player1_id: 'rm-a', player2_id: 'rm-b', status: 'active' });
        expect(unhandled).toEqual([]);
    });
});
