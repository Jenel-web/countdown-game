/**
 * Unit tests for the round-phase state machine in RoomManager. These guard the
 * "score each round exactly once" and "first submission is final" rules.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RoomManager } from '../../src/rooms/RoomManager';
import type { Tile } from '../../src/types/events';

const tiles: Tile[] = [1, 2, 3, 4, 5, 6].map((value, i) => ({
    id: `tile-${i}`,
    value,
    used: false,
    selected: false,
}));

function openRoom(): { rm: RoomManager; id: string } {
    const rm = new RoomManager();
    const id = 'room-1';
    rm.createRoom(id, 'p1');
    rm.joinRoom(id, 'p2');
    return { rm, id };
}

function startRound(rm: RoomManager, id: string) {
    rm.resetRound(id, tiles, 500, true, Date.now());
}

const rooms: RoomManager[] = [];
afterEach(() => {
    // clear any timers held by rooms we created
    for (const rm of rooms.splice(0)) rm.removeRoom('room-1');
});

describe('roundPhase lifecycle', () => {
    it('a new room is idle and accepts no submissions', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        expect(rm.getRoom(id)!.roundPhase).toBe('idle');
        expect(rm.recordSubmission(id, 'player1', { result: 5, timeMs: 10 })).toBe(false);
        expect(rm.getRoom(id)!.submissions.player1).toBeUndefined();
    });

    it('resetRound opens the round (active)', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);
        expect(rm.getRoom(id)!.roundPhase).toBe('active');
    });

    it('beginEvaluation succeeds once, then refuses until the next resetRound', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);

        expect(rm.beginEvaluation(id)).toBe(true);
        expect(rm.getRoom(id)!.roundPhase).toBe('evaluating');
        expect(rm.beginEvaluation(id)).toBe(false);
        expect(rm.beginEvaluation(id)).toBe(false);

        startRound(rm, id);
        expect(rm.beginEvaluation(id)).toBe(true);
    });

    it('beginEvaluation refuses on an idle room and an unknown room', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        expect(rm.beginEvaluation(id)).toBe(false);
        expect(rm.beginEvaluation('nope')).toBe(false);
    });

    it('refuses submissions once the round is evaluating, even though the old submissions are still stored', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);
        rm.recordSubmission(id, 'player1', { result: 5, timeMs: 10 });
        rm.recordSubmission(id, 'player2', { result: 6, timeMs: 20 });
        expect(rm.bothSubmitted(id)).toBe(true);

        rm.beginEvaluation(id);
        // The replay attack: submissions from the finished round are still present...
        expect(rm.bothSubmitted(id)).toBe(true);
        // ...but nothing new can be recorded on top of them.
        expect(rm.recordSubmission(id, 'player1', { result: 500, timeMs: 1 })).toBe(false);
        expect(rm.getRoom(id)!.submissions.player1!.result).toBe(5);
    });

    it('resetRound clears the previous round submissions and reopens submissions', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);
        rm.recordSubmission(id, 'player1', { result: 5, timeMs: 10 });
        rm.beginEvaluation(id);

        startRound(rm, id);
        expect(rm.getRoom(id)!.submissions).toEqual({});
        expect(rm.recordSubmission(id, 'player1', { result: 7, timeMs: 3 })).toBe(true);
    });
});

describe('recordSubmission', () => {
    it('the first submission per slot is final', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);

        expect(rm.recordSubmission(id, 'player1', { result: 5, timeMs: 100 })).toBe(true);
        expect(rm.recordSubmission(id, 'player1', { result: 500, timeMs: 1 })).toBe(false);
        expect(rm.getRoom(id)!.submissions.player1).toEqual({ result: 5, timeMs: 100 });
    });

    it('a null (invalid) first submission still counts as the slot\'s one submission', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);

        expect(rm.recordSubmission(id, 'player1', { result: null, timeMs: 100, steps: [] })).toBe(true);
        expect(rm.recordSubmission(id, 'player1', { result: 500, timeMs: 200 })).toBe(false);
        expect(rm.getRoom(id)!.submissions.player1!.result).toBeNull();
    });

    it('slots are independent', () => {
        const { rm, id } = openRoom();
        rooms.push(rm);
        startRound(rm, id);
        expect(rm.recordSubmission(id, 'player1', { result: 1, timeMs: 1 })).toBe(true);
        expect(rm.bothSubmitted(id)).toBe(false);
        expect(rm.recordSubmission(id, 'player2', { result: 2, timeMs: 2 })).toBe(true);
        expect(rm.bothSubmitted(id)).toBe(true);
    });

    it('returns false for an unknown room', () => {
        const rm = new RoomManager();
        expect(rm.recordSubmission('missing', 'player1', { result: 1, timeMs: 1 })).toBe(false);
    });
});
