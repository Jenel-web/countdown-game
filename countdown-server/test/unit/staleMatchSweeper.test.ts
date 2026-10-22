/**
 * Unit tests for src/maintenance/staleMatchSweeper.ts. The database function is
 * replaced by a fake rpc, so these check the server's side of the contract:
 * what it sends, how often, and that a failing database never crashes it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { startStaleMatchSweeper, SWEEP_INTERVAL_MS, STALE_AFTER_MINUTES } from '../../src/maintenance/staleMatchSweeper';
import { RoomManager } from '../../src/rooms/RoomManager';

const quietLog = () => ({ log: vi.fn(), error: vi.fn() });

afterEach(() => {
    vi.useRealTimers();
});

describe('startStaleMatchSweeper', () => {
    it('calls delete_stale_pending_matches with 30 minutes and the live room ids', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
        const log = quietLog();
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => ['live-1', 'live-2'], log });

        expect(await s.sweep()).toBe(2);
        expect(rpc).toHaveBeenCalledWith('delete_stale_pending_matches', {
            p_older_than_minutes: STALE_AFTER_MINUTES,
            p_keep: ['live-1', 'live-2'],
        });
        expect(log.log).toHaveBeenCalledTimes(1);
        s.stop();
    });

    it('reads the live rooms fresh on every sweep (a room created later is protected too)', async () => {
        const rm = new RoomManager();
        const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => rm.listMatchIds(), log: quietLog() });

        await s.sweep();
        rm.createRoom('waiting-host', 'p1');
        await s.sweep();

        expect(rpc.mock.calls[0][1].p_keep).toEqual([]);
        expect(rpc.mock.calls[1][1].p_keep).toEqual(['waiting-host']);
        rm.removeRoom('waiting-host');
        s.stop();
    });

    it('runs every 5 minutes until stopped', async () => {
        vi.useFakeTimers();
        const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log: quietLog() });

        await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
        expect(rpc).toHaveBeenCalledTimes(3);

        s.stop();
        await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('a database error is logged with a hint, returns null, and never throws', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
        const log = quietLog();
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log });

        await expect(s.sweep()).resolves.toBeNull();
        expect(log.error.mock.calls[0][0]).toMatch(/function does not exist.*lockdown-a\.sql/);
        s.stop();
    });

    it('a thrown/rejected rpc is caught too', async () => {
        const rpc = vi.fn().mockRejectedValue(new Error('network down'));
        const log = quietLog();
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log });

        await expect(s.sweep()).resolves.toBeNull();
        expect(log.error).toHaveBeenCalled();
        s.stop();
    });

    it('a slow database does not stack sweeps: an overlapping call is skipped', async () => {
        let release!: (v: { data: number; error: null }) => void;
        const rpc = vi.fn().mockReturnValue(new Promise((r) => (release = r)));
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log: quietLog() });

        const first = s.sweep();
        await expect(s.sweep()).resolves.toBeNull(); // skipped while the first is in flight
        expect(rpc).toHaveBeenCalledTimes(1);

        release({ data: 1, error: null });
        await expect(first).resolves.toBe(1);
        // ...and once it finishes, the next sweep runs normally.
        rpc.mockResolvedValue({ data: 0, error: null });
        await expect(s.sweep()).resolves.toBe(0);
        s.stop();
    });

    it('nothing deleted: no log noise', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
        const log = quietLog();
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log });
        await s.sweep();
        expect(log.log).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
        s.stop();
    });

    it('treats a non-number reply as zero deleted', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: 'weird', error: null });
        const s = startStaleMatchSweeper({ rpc, liveMatchIds: () => [], log: quietLog() });
        await expect(s.sweep()).resolves.toBe(0);
        s.stop();
    });
});
