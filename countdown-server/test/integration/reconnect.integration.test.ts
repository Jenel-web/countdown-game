/**
 * =============================================================================
 * FILE: test/integration/reconnect.integration.test.ts
 * A player who drops and comes back mid-match must always get the board back,
 * must never be forfeited while they are really present, and must never be
 * able to keep playing after the grace period has passed.
 *
 * (Under NODE_ENV=test the grace period is 100ms instead of 15s. Reconnects
 * below are done immediately so they land inside it.)
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
/** Comfortably longer than the 100ms test grace period. */
const PAST_GRACE_MS = 400;

let server: TestServerHandle;
const openSockets: TestClientSocket[] = [];

beforeAll(async () => {
    const { startTestServer } = await import('./helpers/testServer');
    server = await startTestServer();
});
afterAll(async () => {
    await server?.close();
});
afterEach(() => {
    for (const s of openSockets.splice(0)) s.disconnect();
});

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

function collect<T = any>(socket: TestClientSocket, event: string): T[] {
    const seen: T[] = [];
    (socket as any).on(event, (p: T) => seen.push(p));
    return seen;
}

const rowOf = (id: string) => mockAdmin.__state.matches.find((m) => m.id === id);
const finishCallsFor = (id: string) => mockAdmin.__state.finishMatchCalls.filter((c) => c.p_match_id === id);

async function startMatch(u1: string, u2: string) {
    const matchId = randomUUID();
    mockAdmin.__state.matches.push({ id: matchId, player1_id: u1, player2_id: null, status: 'pending', winner_id: null });

    const c1 = await connect(u1);
    const c2 = await connect(u2);
    c1.emit('join_room', { matchId });
    await waitForEvent(c1, 'waiting_for_opponent');

    const rs1 = waitForEvent<any>(c1, 'round_start', ROUND_START_TIMEOUT);
    const rs2 = waitForEvent<any>(c2, 'round_start', ROUND_START_TIMEOUT);
    c2.emit('join_room', { matchId });
    const [first] = await Promise.all([rs1, rs2]);
    return { matchId, c1, c2, round: first as { tiles: Tile[]; target: number; startTimestamp: number; roundNumber: number } };
}

function validAdd(tiles: Tile[]) {
    const [a, b] = tiles;
    const result = a.value + b.value;
    return { steps: [{ a: a.value, op: '+' as const, b: b.value, result }], resultValue: result };
}

/** Opens a fresh socket for `userId`, joins the match, and records what it is sent. */
async function rejoin(userId: string, matchId: string) {
    const s = await connect(userId);
    const joined = collect<any>(s, 'opponent_joined');
    const rounds = collect<any>(s, 'round_start');
    const waiting = collect(s, 'waiting_for_opponent');
    const errors = collect<{ code: string }>(s, 'error');
    s.emit('join_room', { matchId });
    return { s, joined, rounds, waiting, errors };
}

describe('reconnect: connection already noticed as dead (forfeit timer pending)', () => {
    it('returns the same board and totals inside the grace period, and nobody is forfeited', async () => {
        const { matchId, c1, c2, round } = await startMatch('rc-a1', 'rc-a2');
        const oppLeft = collect(c2, 'opponent_left');
        server.roomManager.getRoom(matchId)!.player1TotalRaw = 170;

        c1.disconnect();
        const back = await rejoin('rc-a1', matchId);
        await waitFor(() => back.rounds.length > 0);

        expect(back.joined).toHaveLength(1);
        expect(back.rounds[0].tiles.map((t: Tile) => t.value)).toEqual(round.tiles.map((t) => t.value));
        expect(back.rounds[0].target).toBe(round.target);
        expect(back.rounds[0].startTimestamp).toBe(round.startTimestamp); // timer keeps running from the SAME start
        expect(back.rounds[0].player1TotalRaw).toBe(170);

        await sleep(PAST_GRACE_MS);
        expect(oppLeft).toHaveLength(0);
        expect(finishCallsFor(matchId)).toHaveLength(0);
        expect(server.roomManager.getRoom(matchId)).toBeDefined();
    });

    it('LEAVE VIA BACK BUTTON then return inside the grace period: the ignored cancel does not cost the match', async () => {
        const { matchId, c1, c2 } = await startMatch('back-1', 'back-2');
        const oppLeft = collect(c2, 'opponent_left');

        // What the Back / "back to lobby" buttons do: cancel_room, then drop the socket.
        c1.emit('cancel_room', { matchId });
        c1.disconnect();

        const back = await rejoin('back-1', matchId);
        await waitFor(() => back.rounds.length > 0);
        await sleep(PAST_GRACE_MS);

        expect(oppLeft).toHaveLength(0);
        expect(finishCallsFor(matchId)).toHaveLength(0);
        expect(rowOf(matchId)?.status).toBe('active');
    });

    it('LEAVE VIA BACK BUTTON and stay away: after the grace period it is a forfeit loss', async () => {
        const { matchId, c1, c2 } = await startMatch('gone-1', 'gone-2');
        const oppLeft = collect(c2, 'opponent_left');

        c1.emit('cancel_room', { matchId });
        c1.disconnect();

        await waitFor(() => oppLeft.length > 0);
        await waitFor(() => finishCallsFor(matchId).length === 1);
        expect(finishCallsFor(matchId)[0]).toMatchObject({ p_winner_id: 'gone-2', p_loser_id: 'gone-1' });
        expect(rowOf(matchId)?.status).toBe('completed');
    });

    it('returning AFTER the grace period is too late: the match is already forfeited', async () => {
        const { matchId, c1, c2 } = await startMatch('late-1', 'late-2');
        const oppLeft = collect(c2, 'opponent_left');

        c1.disconnect();
        await waitFor(() => oppLeft.length > 0);
        await waitFor(() => finishCallsFor(matchId).length === 1);

        const back = await rejoin('late-1', matchId);
        await waitFor(() => back.errors.length > 0);
        expect(back.errors[0].code).toBe('match_finished');
        expect(back.rounds).toHaveLength(0);
    });

    it('the returning player can keep playing: their answer counts and they receive the round result', async () => {
        const { matchId, c1, c2, round } = await startMatch('play-1', 'play-2');
        c1.disconnect();
        const back = await rejoin('play-1', matchId);
        await waitFor(() => back.rounds.length > 0);

        const resultOnNewSocket = waitForEvent<any>(back.s, 'round_result');
        const add = validAdd(round.tiles);
        back.s.emit('submit_answer', add);
        c2.emit('submit_answer', { steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], resultValue: 0 });

        const rr = await resultOnNewSocket;
        expect(rr.player1.result).toBe(add.resultValue);
        expect(rr.player1.pointsRaw).toBe(100);
    });
});

describe('reconnect: new connection arrives BEFORE the old one is noticed as dead (the stuck case)', () => {
    it('player1 on a second socket still gets the board back', async () => {
        const { matchId, c1, c2, round } = await startMatch('dup-1', 'dup-2');
        const oppLeft = collect(c2, 'opponent_left');

        // c1 is still connected - e.g. a page refresh or a silent network drop.
        const back = await rejoin('dup-1', matchId);
        await waitFor(() => back.rounds.length > 0);

        expect(back.joined).toHaveLength(1);
        expect(back.rounds[0].target).toBe(round.target);
        expect(back.rounds[0].tiles.map((t: Tile) => t.value)).toEqual(round.tiles.map((t) => t.value));
        expect(server.roomManager.getRoom(matchId)!.player1SocketId).toBe(back.s.id);

        // The old connection finally closes. That must NOT forfeit the player who is back.
        c1.disconnect();
        await sleep(PAST_GRACE_MS);
        expect(oppLeft).toHaveLength(0);
        expect(finishCallsFor(matchId)).toHaveLength(0);
        expect(server.roomManager.getRoom(matchId)!.player1SocketId).toBe(back.s.id);
    });

    it('player2 on a second socket still gets the board back', async () => {
        const { matchId, c1, c2, round } = await startMatch('dup-3', 'dup-4');
        const oppLeft = collect(c1, 'opponent_left');
        server.roomManager.getRoom(matchId)!.player2TotalRaw = 80;

        const back = await rejoin('dup-4', matchId);
        await waitFor(() => back.rounds.length > 0);

        expect(back.rounds[0].target).toBe(round.target);
        expect(back.rounds[0].player2TotalRaw).toBe(80);

        c2.disconnect();
        await sleep(PAST_GRACE_MS);
        expect(oppLeft).toHaveLength(0);
        expect(finishCallsFor(matchId)).toHaveLength(0);
    });

    it('if the NEW connection then drops for good, the forfeit still happens', async () => {
        const { matchId, c1, c2 } = await startMatch('dup-5', 'dup-6');
        const oppLeft = collect(c2, 'opponent_left');

        const back = await rejoin('dup-5', matchId);
        await waitFor(() => back.rounds.length > 0);
        c1.disconnect(); // stale one, ignored
        back.s.disconnect(); // the real one

        await waitFor(() => oppLeft.length > 0);
        await waitFor(() => finishCallsFor(matchId).length === 1);
        expect(finishCallsFor(matchId)[0]).toMatchObject({ p_winner_id: 'dup-6', p_loser_id: 'dup-5' });
    });
});

describe('reconnect: timing inside the match', () => {
    it('between rounds the finished round is NOT resent (the next broadcast will reach the new socket)', async () => {
        const { matchId } = await startMatch('gap-1', 'gap-2');
        server.roomManager.getRoom(matchId)!.roundPhase = 'evaluating'; // result showing / next round queued

        const back = await rejoin('gap-1', matchId);
        await waitFor(() => back.joined.length > 0);
        await sleep(200);

        expect(back.rounds).toHaveLength(0);
        // ...and it is in the Socket.io room, so the next round_start broadcast does reach it.
        const next = waitForEvent<any>(back.s, 'round_start');
        server.io.to(matchId).emit('round_start', {
            roundNumber: 99, tiles: [], target: 100, startTimestamp: Date.now(), durationMs: 30_000,
        });
        expect((await next).roundNumber).toBe(99);
    });

    it('reconnecting after submitting does not allow a second submission', async () => {
        const { matchId, c1, round } = await startMatch('once-1', 'once-2');
        c1.emit('submit_answer', validAdd(round.tiles));
        await waitFor(() => !!server.roomManager.getRoom(matchId)!.submissions.player1);
        const first = server.roomManager.getRoom(matchId)!.submissions.player1;

        const back = await rejoin('once-1', matchId);
        await waitFor(() => back.rounds.length > 0);
        back.s.emit('submit_answer', { steps: [{ a: round.tiles[0].value, op: '+' as const, b: 999999, result: 1 }], resultValue: 1 });
        await sleep(150);

        expect(server.roomManager.getRoom(matchId)!.submissions.player1).toBe(first);
    });
});

describe('reconnect: lobby and impostors (unchanged behaviour)', () => {
    it('a host who refreshes the waiting room gets waiting_for_opponent again and the room survives the old socket closing', async () => {
        const matchId = randomUUID();
        mockAdmin.__state.matches.push({ id: matchId, player1_id: 'host-r', player2_id: null, status: 'pending', winner_id: null });
        const old = await connect('host-r');
        old.emit('join_room', { matchId });
        await waitForEvent(old, 'waiting_for_opponent');

        const back = await rejoin('host-r', matchId);
        await waitFor(() => back.waiting.length > 0);
        old.disconnect();
        await sleep(PAST_GRACE_MS);

        expect(server.roomManager.getRoom(matchId)).toBeDefined();
        expect(rowOf(matchId)).toBeDefined();
        expect(back.rounds).toHaveLength(0);
    });

    it('a stranger cannot take over a live match slot by joining it', async () => {
        const { matchId } = await startMatch('imp-1', 'imp-2');
        const before = { ...server.roomManager.getRoom(matchId)! };

        const intruder = await rejoin('intruder', matchId);
        await waitFor(() => intruder.errors.length > 0);

        expect(intruder.errors[0].code).toBe('room_full');
        expect(intruder.rounds).toHaveLength(0);
        const after = server.roomManager.getRoom(matchId)!;
        expect(after.player1SocketId).toBe(before.player1SocketId);
        expect(after.player2SocketId).toBe(before.player2SocketId);
    });
});
