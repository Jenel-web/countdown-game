/**
 * =============================================================================
 * FILE: scripts/flood-sim.ts
 * PURPOSE: Hammer YOUR OWN local game server with the kinds of floods a
 * denial-of-service attempt would use, and report how much of it got through.
 * Compare a run before and after the rate limiter to see what it buys you.
 *
 * SAFETY
 *   - Refuses any server that is not localhost / 127.0.0.1.
 *   - Volumes are capped (see MAX_* below). Every connection that gets past the
 *     IP limiter makes one Supabase auth call, and every join_room that gets
 *     through makes one Supabase read, so keep this to a throwaway account.
 *
 * USAGE (from countdown-server/, game server running on :4000)
 *   TOKEN_A=<access token> npx tsx scripts/flood-sim.ts            # all three
 *   TOKEN_A=<access token> npx tsx scripts/flood-sim.ts events 800
 *   TOKEN_A=<access token> npx tsx scripts/flood-sim.ts conns 40
 *   TOKEN_A=<access token> npx tsx scripts/flood-sim.ts big
 *
 *   events  one connection fires N join_room events at full speed
 *           (each processed one is a database lookup)
 *   conns   N connection attempts for one account from one IP
 *           (each accepted one is a Supabase auth call)
 *   big     oversized packets (50 KB and 5 MB)
 *
 * Get a token with:  npx tsx scripts/get-token.ts <username> <password>
 * =============================================================================
 */

import { io, type Socket } from 'socket.io-client';
import { assertLocalhost } from './attack-sim';

const MAX_EVENTS = 2000;
const MAX_CONNS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(url: string, token: string): Promise<{ ok: boolean; message?: string; socket: Socket }> {
  const socket = io(url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve) => {
    socket.once('connect', () => resolve({ ok: true, socket }));
    socket.once('connect_error', (e) => resolve({ ok: false, message: e.message, socket }));
  });
}

async function healthMs(url: string): Promise<string> {
  const t = Date.now();
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? `${Date.now() - t}ms` : `HTTP ${r.status}`;
  } catch {
    return 'NO RESPONSE (timed out or refused)';
  }
}

export interface FloodReport {
  mode: string;
  lines: string[];
}

export async function floodEvents(url: string, token: string, n: number): Promise<FloodReport> {
  n = Math.min(n, MAX_EVENTS);
  const c = await open(url, token);
  if (!c.ok) return { mode: 'events', lines: [`could not connect: ${c.message}`] };
  let answered = 0;
  c.socket.on('error', () => answered++);
  let closedAt: number | null = null;
  c.socket.on('disconnect', () => (closedAt = answered));

  const t0 = Date.now();
  for (let i = 0; i < n; i++) (c.socket as any).emit('join_room', { matchId: `flood-${i}` });
  await sleep(3000);
  const lines = [
    `sent ${n} join_room events in ${Date.now() - t0}ms`,
    `server processed (answered) ${answered} of ${n}   <- each is one database lookup`,
    closedAt !== null
      ? `server DISCONNECTED the flooder after ${closedAt} answered`
      : 'the connection is still open (no cut-off)',
    `/health during/after: ${await healthMs(url)}`,
  ];
  c.socket.disconnect();
  return { mode: 'events', lines };
}

export async function floodConnections(url: string, token: string, n: number): Promise<FloodReport> {
  n = Math.min(n, MAX_CONNS);
  const results = await Promise.all(Array.from({ length: n }, () => open(url, token)));
  const accepted = results.filter((r) => r.ok).length;
  const byReason = new Map<string, number>();
  for (const r of results) if (!r.ok) byReason.set(r.message ?? 'unknown', (byReason.get(r.message ?? 'unknown') ?? 0) + 1);
  const lines = [
    `${n} connection attempts, one account, one IP`,
    `accepted: ${accepted}   <- each is a Supabase auth call + memory`,
    ...[...byReason.entries()].map(([msg, count]) => `refused ${count}x: "${msg}"`),
    `/health: ${await healthMs(url)}`,
  ];
  results.forEach((r) => r.socket.disconnect());
  return { mode: 'conns', lines };
}

export async function floodBig(url: string, token: string): Promise<FloodReport> {
  const lines: string[] = [];
  for (const [label, bytes] of [['50 KB', 50_000], ['5 MB', 5_000_000]] as const) {
    const c = await open(url, token);
    if (!c.ok) {
      lines.push(`${label}: could not connect (${c.message}) - IP/account limit already tripped, wait a minute and rerun`);
      continue;
    }
    let closed = false;
    c.socket.on('disconnect', () => (closed = true));
    (c.socket as any).emit('player_status', { status: 'thinking', junk: 'x'.repeat(bytes) });
    await sleep(1500);
    lines.push(`${label} packet: ${closed ? 'connection CLOSED by the server' : 'accepted, connection still open'}`);
    c.socket.disconnect();
  }
  return { mode: 'big', lines };
}

async function main() {
  const url = process.env.SERVER_URL ?? 'http://localhost:4000';
  assertLocalhost(url);
  const token = process.env.TOKEN_A;
  if (!token) {
    console.error('Set TOKEN_A (see the usage notes at the top of this file).');
    process.exit(2);
  }
  const mode = process.argv[2] ?? 'all';
  const n = Number(process.argv[3]);
  const reports: FloodReport[] = [];

  console.log(`Flooding ${url} (/health right now: ${await healthMs(url)})\n`);
  if (mode === 'events' || mode === 'all') reports.push(await floodEvents(url, token, Number.isFinite(n) && n > 0 ? n : 500));
  if (mode === 'conns' || mode === 'all') reports.push(await floodConnections(url, token, Number.isFinite(n) && n > 0 ? n : 40));
  if (mode === 'big' || mode === 'all') reports.push(await floodBig(url, token));
  if (reports.length === 0) {
    console.error('mode must be one of: all, events, conns, big');
    process.exit(2);
  }
  for (const r of reports) {
    console.log(`── ${r.mode} ──`);
    r.lines.forEach((l) => console.log('  ' + l));
    console.log();
  }
  process.exit(0);
}

if (process.argv[1] && /flood-sim\.[tj]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(2);
  });
}
