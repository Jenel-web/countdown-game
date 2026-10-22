/**
 * =============================================================================
 * FILE: src/maintenance/staleMatchSweeper.ts
 * RESPONSIBILITY: Delete challenges nobody joined, so the matches table does not
 * fill up with dead 'pending' rows (closed tabs, crashed browsers, spam).
 *
 * The deleting itself is done by the database function
 * delete_stale_pending_matches() (docs/sql/2026-10-21-lockdown-a.sql), which
 * only the service role may call. This module just calls it on a timer and
 * passes the ids of rooms that are live in THIS server right now, so a host who
 * is still sitting in the waiting room never has their challenge deleted.
 * =============================================================================
 */

export const SWEEP_INTERVAL_MS = 5 * 60_000;
export const STALE_AFTER_MINUTES = 30;

type RpcResult = { data: unknown; error: { message?: string } | null };

export interface SweeperOptions {
  /** Calls a Postgres function as the service role (adminClient.rpc in production). */
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  /** Match ids with a live room on this server; these are never deleted. */
  liveMatchIds: () => string[];
  intervalMs?: number;
  olderThanMinutes?: number;
  log?: Pick<Console, 'log' | 'error'>;
}

export interface Sweeper {
  /** Runs one sweep now. Resolves to the number of rows deleted, or null on failure. */
  sweep: () => Promise<number | null>;
  stop: () => void;
}

export function startStaleMatchSweeper(options: SweeperOptions): Sweeper {
  const intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS;
  const olderThanMinutes = options.olderThanMinutes ?? STALE_AFTER_MINUTES;
  const log = options.log ?? console;
  let running = false;

  const sweep = async (): Promise<number | null> => {
    // A slow database must not stack sweeps on top of each other.
    if (running) return null;
    running = true;
    try {
      const { data, error } = await options.rpc('delete_stale_pending_matches', {
        p_older_than_minutes: olderThanMinutes,
        p_keep: options.liveMatchIds(),
      });
      if (error) {
        log.error(
          `[sweeper] delete_stale_pending_matches failed: ${error.message ?? 'unknown error'}` +
            ' (if the function does not exist yet, run docs/sql/2026-10-21-lockdown-a.sql)'
        );
        return null;
      }
      const deleted = typeof data === 'number' ? data : 0;
      if (deleted > 0) log.log(`[sweeper] deleted ${deleted} challenge(s) nobody joined within ${olderThanMinutes} minutes`);
      return deleted;
    } catch (err) {
      log.error('[sweeper] sweep threw:', err);
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  // Never keep the process alive just for housekeeping.
  timer.unref();

  return { sweep, stop: () => clearInterval(timer) };
}
