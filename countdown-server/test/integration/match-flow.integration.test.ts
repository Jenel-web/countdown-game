/**
 * =============================================================================
 * FILE: test/integration/match-flow.integration.test.ts
 * Full end-to-end tests of the real Socket.io server (authMiddleware,
 * RoomManager, roomHandlers, roundHandlers) using REAL socket.io-client
 * connections, with Supabase swapped out for the in-memory fake in
 * mockAdminClient.ts. Nothing here touches a real database.
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMockAdminClient, type MockAdminClient } from './helpers/mockAdminClient';

// -----------------------------------------------------------------------------
// IMPORTANT — read before changing anything above this comment:
// vi.mock() calls are hoisted by Vitest to the very top of this file,
// before any of the imports below even run. The factory here is
// self-contained (it calls createMockAdminClient() itself rather than
// referencing an outer variable), which is what makes this safe under
// hoisting. Because ES module imports are cached, EVERY file in the
// dependency graph that imports '../../src/supabase/adminClient' —
// authMiddleware.ts, roomHandlers.ts, roundHandlers.ts, and this test file
// itself — receives the exact same mock instance, which is exactly what we
// want: one shared fake database for the whole test file's server.
// -----------------------------------------------------------------------------
vi.mock('../../src/supabase/adminClient', () => ({
    adminClient: createMockAdminClient(),
}));

// Importing AFTER vi.mock gives us the mock instance itself, so tests can
// seed data into it and assert against its recorded calls/state.
import { adminClient } from '../../src/supabase/adminClient';
const mockAdmin = adminClient as unknown as MockAdminClient;

import { type TestServerHandle } from './helpers/testServer';
//import { startTestServer } from './helpers/testServer';
import {
    createTestClient,
    waitForConnect,
    waitForEvent,
    type TestClientSocket,
} from './helpers/testClient';
import { applyOp } from '../../src/game/gameEngine';
import type { Tile, Step } from '../../src/types/events';

// round_start is generated right after checkSolvability() runs synchronously on
// the server. Measured latency: p50 ~20ms, p99 ~1.9s. A tight timeout here
// causes flaky failures that look like bugs but are just slow puzzles.
const ROUND_START_TIMEOUT = 8000;

let server: TestServerHandle;
const openSockets: TestClientSocket[] = [];


beforeAll(async () => {
    // Dynamically import testServer AFTER all vi.mock setups have run
    const { startTestServer } = await import('./helpers/testServer');
    server = await startTestServer();
});

afterAll(async () => {
    await server?.close();
});
afterEach(() => {
    // Always disconnect every socket a test opened, so one test's leftover
    // connection can't bleed into the next test's event listeners.
    for (const s of openSockets.splice(0)) {
        s.disconnect();
    }
});

/** Seeds a fresh 'waiting' match row, the same shape join_room expects to find. */
function seedWaitingMatch(matchId: string, player1Id: string) {
    mockAdmin.__state.matches.push({
        id: matchId,
        player1_id: player1Id,
        player2_id: null,
        status: 'waiting',
        winner_id: null,
    });
}

/**
 * Builds a GUARANTEED-legal single-step submission from whatever tiles the
 * server actually generated for this round. Addition is always legal in
 * applyOp (no negative/fraction restriction), so summing the first two
 * tiles works no matter which random tiles came back — no need to hardcode
 * tile values that might not appear in a given randomly generated round.
 */
function buildValidAdditionSubmission(tiles: Tile[]): { steps: Step[]; resultValue: number } {
    const [a, b] = tiles;
    const result = applyOp(a.value, '+', b.value)!; // addition can never fail
    return {
        steps: [{ a: a.value, op: '+', b: b.value, result }],
        resultValue: result,
    };
}

/** The mock is shared across the whole file, so always scope assertions to one matchId. */
function finishCallsFor(matchId: string) {
    return mockAdmin.__state.finishMatchCalls.filter((c) => c.p_match_id === matchId);
}

function connectAndJoin(matchId: string, userId: string) {
    const socket = createTestClient(server.url, userId);
    openSockets.push(socket);
    return socket;
}

describe('full match flow (real sockets, mocked Supabase)', () => {
    it('two players joining triggers opponent_joined and round_start with identical tiles/target for both', async () => {
        const matchId = randomUUID();
        seedWaitingMatch(matchId, 'user-1');

        const client1 = connectAndJoin(matchId, 'user-1');
        await waitForConnect(client1);
        client1.emit('join_room', { matchId });
        await waitForEvent(client1, 'waiting_for_opponent');

        const client2 = connectAndJoin(matchId, 'user-2');
        await waitForConnect(client2);

        // RULE for every event-driven test: register ALL listeners BEFORE the
        // action that triggers the events. The server emits opponent_joined and
        // round_start back-to-back, so a listener added after awaiting the first
        // one would miss the second entirely (it would look like a timeout).
        const joined1 = waitForEvent<{ player1Id: string; player2Id: string }>(client1, 'opponent_joined');
        const joined2 = waitForEvent<{ player1Id: string; player2Id: string }>(client2, 'opponent_joined');
        const roundStart1 = waitForEvent<{ tiles: Tile[]; target: number; roundNumber: number }>(client1, 'round_start', ROUND_START_TIMEOUT);
        const roundStart2 = waitForEvent<{ tiles: Tile[]; target: number; roundNumber: number }>(client2, 'round_start', ROUND_START_TIMEOUT);

        client2.emit('join_room', { matchId });

        const [joinedPayload1, joinedPayload2] = await Promise.all([joined1, joined2]);

        expect(joinedPayload1).toEqual({ player1Id: 'user-1', player2Id: 'user-2' });
        expect(joinedPayload2).toEqual({ player1Id: 'user-1', player2Id: 'user-2' });

        // The Supabase row should now reflect the match becoming active — this
        // confirms roomHandlers really wrote back to the (mocked) database, not
        // just updated its own in-memory state.
        const row = mockAdmin.__state.matches.find((m) => m.id === matchId);
        expect(row?.status).toBe('active');
        expect(row?.player2_id).toBe('user-2');

        const [round1, round2] = await Promise.all([roundStart1, roundStart2]);

        expect(round1.roundNumber).toBe(1);
        expect(round1.tiles).toHaveLength(6);
        expect(round1.target).toBeGreaterThanOrEqual(100);
        expect(round1.target).toBeLessThanOrEqual(999);

        // THE key real-time-fairness property from the whole system design:
        // both players must receive the EXACT same puzzle.
        expect(round2.target).toBe(round1.target);
        expect(round2.tiles.map((t) => t.value)).toEqual(round1.tiles.map((t) => t.value));
    });

    it('submitting a valid answer produces a correctly scored round_result, persisted to the rounds table', async () => {
        const matchId = randomUUID();
        seedWaitingMatch(matchId, 'user-1');

        const client1 = connectAndJoin(matchId, 'user-1');
        const client2 = connectAndJoin(matchId, 'user-2');
        await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

        client1.emit('join_room', { matchId });
        await waitForEvent(client1, 'waiting_for_opponent');

        const roundStartPromise = waitForEvent<{ tiles: Tile[]; target: number }>(client1, 'round_start', ROUND_START_TIMEOUT);
        client2.emit('join_room', { matchId });
        const roundStart = await roundStartPromise;

        const { steps, resultValue } = buildValidAdditionSubmission(roundStart.tiles);

        const resultPromise1 = waitForEvent<any>(client1, 'round_result');
        const resultPromise2 = waitForEvent<any>(client2, 'round_result');

        // Player 1 submits a real, legal move. Player 2 deliberately never
        // submits at all — from scoreRound's perspective this is identical to
        // a genuine timeout, which is exactly what we're relying on to trigger
        // evaluateRound's 30-second setTimeout path... except we don't want to
        // actually wait 30 real seconds in a test. Submitting from BOTH sides
        // is what makes evaluateRound fire immediately instead, so we submit a
        // second, deliberately-losing answer from client2 too.
        client1.emit('submit_answer', { steps, resultValue });
        client2.emit('submit_answer', {
            steps: [{ a: 999999, op: '+', b: 1, result: 1000000 }], // tiles that were never in this round at all
            resultValue: 1000000,
        });

        const [roundResult1, roundResult2] = await Promise.all([resultPromise1, resultPromise2]);

        // Player 2's submission referenced tiles that don't exist in this
        // round's pool — validateSubmission must reject it, meaning player 2
        // is scored exactly as if they'd submitted nothing (null result),
        // which per scoreRound's rules means player 1 gets an automatic win.
        expect(roundResult1.player1.outcome).toBe('win');
        expect(roundResult1.player1.pointsRaw).toBe(100);
        expect(roundResult1.player2.outcome).toBe('loss');
        expect(roundResult1.player2.pointsRaw).toBe(0);

        // Both clients should have received an identical broadcast.
        expect(roundResult2).toEqual(roundResult1);

        // And the round should be persisted to the (mocked) rounds table.
        const roundsForThisMatch = mockAdmin.__state.rounds.filter((r) => r.match_id === matchId);
        expect(roundsForThisMatch).toHaveLength(1);
        const persisted = roundsForThisMatch[0];
        expect(persisted.match_id).toBe(matchId);
        expect(persisted.round_number).toBe(1);
        expect(persisted.player1_result).toBe(resultValue);
        expect(persisted.player2_result).toBeNull(); // rejected submission -> stored as null, same as a real timeout
    });

    it('driving a match to 5 points calls finish_match with the correct winner/loser and marks the row finished', async () => {
        const matchId = randomUUID();
        seedWaitingMatch(matchId, 'winner-user');

        const client1 = connectAndJoin(matchId, 'winner-user');
        const client2 = connectAndJoin(matchId, 'loser-user');
        await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

        client1.emit('join_room', { matchId });
        await waitForEvent(client1, 'waiting_for_opponent');

        let roundStartPromise = waitForEvent<{ tiles: Tile[] }>(client1, 'round_start', ROUND_START_TIMEOUT);
        client2.emit('join_room', { matchId });
        let roundStart = await roundStartPromise;

        let matchOverPayload: any = null;
        const matchOverListener = waitForEvent<any>(client1, 'match_over', 15000);

        // Player 1 wins every round outright (exact winner behavior doesn't
        // matter for this test — we just need SOMEONE to reliably win round
        // after round until checkMatchOver fires). Player 2 always submits a
        // nonsense/rejected answer, guaranteeing player 1 the automatic win
        // (100 raw points) each round, exactly like the previous test — so
        // player 1 should cross 500 raw points (5.00) within 5 rounds.
        for (let round = 0; round < 6; round++) {
            const { steps, resultValue } = buildValidAdditionSubmission(roundStart.tiles);

            const nextRoundOrMatchOver = Promise.race([
                waitForEvent<{ tiles: Tile[] }>(client1, 'round_start', ROUND_START_TIMEOUT).then((p) => ({ type: 'round' as const, payload: p })),
                matchOverListener.then((p) => ({ type: 'match_over' as const, payload: p })),
            ]);

            client1.emit('submit_answer', { steps, resultValue });
            client2.emit('submit_answer', { steps: [{ a: -1, op: '+', b: -1, result: -2 }], resultValue: -2 });

            const outcome = await nextRoundOrMatchOver;
            if (outcome.type === 'match_over') {
                matchOverPayload = outcome.payload;
                break;
            }
            roundStart = outcome.payload;
        }

        expect(matchOverPayload).not.toBeNull();
        expect(matchOverPayload.winnerId).toBe('winner-user');
        expect(matchOverPayload.player1TotalRaw).toBeGreaterThanOrEqual(500);

        const callsForThisMatch = finishCallsFor(matchId);
        expect(callsForThisMatch).toHaveLength(1);
        expect(callsForThisMatch[0]).toEqual({
            p_match_id: matchId,
            p_winner_id: 'winner-user',
            p_loser_id: 'loser-user',
            // Winner won every round outright (100 raw each) until crossing 500;
            // loser's forged submissions scored nothing.
            p_winner_score: matchOverPayload.player1TotalRaw,
            p_loser_score: 0,
        });

        const row = mockAdmin.__state.matches.find((m) => m.id === matchId);
        expect(row?.status).toBe('finished');
        expect(row?.winner_id).toBe('winner-user');

        const winnerUpdate = mockAdmin.__state.profileUpdates.find((u) => u.id === 'winner-user');
        const loserUpdate = mockAdmin.__state.profileUpdates.find((u) => u.id === 'loser-user');
        expect(winnerUpdate?.patch).toMatchObject({ mmr: 1025, wins: 1 });
        expect(loserUpdate?.patch).toMatchObject({ mmr: 985, losses: 1 });
    }, 20000);

    it('a mid-match disconnect awards the remaining player an immediate forfeit win', async () => {
        const matchId = randomUUID();
        seedWaitingMatch(matchId, 'staying-user');

        const client1 = connectAndJoin(matchId, 'staying-user');
        const client2 = connectAndJoin(matchId, 'leaving-user');
        await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

        client1.emit('join_room', { matchId });
        await waitForEvent(client1, 'waiting_for_opponent');

        const opponentLeftPromise = waitForEvent(client1, 'opponent_left');

        const roundStartPromise = waitForEvent(client1, 'round_start', ROUND_START_TIMEOUT);
        client2.emit('join_room', { matchId });
        await roundStartPromise; // ensure the match is genuinely active before disconnecting

        client2.disconnect();

        await opponentLeftPromise; // resolves or the test times out and fails — that IS the assertion

        expect(finishCallsFor(matchId)).toEqual([
            {
                p_match_id: matchId,
                p_winner_id: 'staying-user',
                p_loser_id: 'leaving-user',
                p_winner_score: 0, // no rounds had finished yet
                p_loser_score: 0,
            },
        ]);

        const row = mockAdmin.__state.matches.find((m) => m.id === matchId);
        expect(row?.status).toBe('finished');
        expect(row?.winner_id).toBe('staying-user');

        const winnerForfeitUpdate = mockAdmin.__state.profileUpdates.find((u) => u.id === 'staying-user');
        const loserForfeitUpdate = mockAdmin.__state.profileUpdates.find((u) => u.id === 'leaving-user');
        expect(winnerForfeitUpdate?.patch).toMatchObject({ mmr: 1025, wins: 1 });
        expect(loserForfeitUpdate?.patch).toMatchObject({ mmr: 985, losses: 1 });
    });

    it('BOTH players disconnecting at once finishes the match exactly once (no double finish_match)', async () => {
        const matchId = randomUUID();
        seedWaitingMatch(matchId, 'user-a');

        const client1 = connectAndJoin(matchId, 'user-a');
        const client2 = connectAndJoin(matchId, 'user-b');
        await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

        client1.emit('join_room', { matchId });
        await waitForEvent(client1, 'waiting_for_opponent');

        const roundStartPromise = waitForEvent(client1, 'round_start', ROUND_START_TIMEOUT);
        client2.emit('join_room', { matchId });
        await roundStartPromise;

        // Simulate a realistic ~50ms database round-trip. With an instant mock the
        // first disconnect handler finishes before the second even starts, hiding
        // the race this test exists to catch.
        mockAdmin.__setRpcLatency(50);

        // Both drop in the same tick — e.g. a shared network outage.
        client1.disconnect();
        client2.disconnect();

        // Give the server's async disconnect handlers time to run to completion.
        await new Promise((r) => setTimeout(r, 400));
        mockAdmin.__setRpcLatency(0);

        expect(finishCallsFor(matchId)).toHaveLength(1);
    });
});