/**
 * =============================================================================
 * FILE: scripts/attack-sim.ts
 * PURPOSE: Play the cheater against YOUR OWN local game server, so you can watch
 * each exploit from the security audit get blocked. Every scenario prints what
 * the attack does, what a defended server should do, what was actually
 * observed, and DEFENDED / VULNERABLE.
 *
 * SAFETY
 *   - Refuses any server that is not localhost / 127.0.0.1 / [::1]. The check lives in
 *     lib/localTarget.ts and is repeated on every connection and request.
 *   - Use two THROWAWAY test accounts. The scripted match is left unfinished
 *     (nobody forfeits, so no MMR changes), but it does leave one `matches` row
 *     behind with status 'active' (the stale-match sweeper isn't built yet).
 *
 * USAGE (from countdown-server/, with the game server running on :4000)
 *
 *   1. Get an access token for each test account (they last about an hour):
 *        SUPABASE_URL=... SUPABASE_ANON_KEY=... SIM_PASSWORD=<passwordA> npx tsx scripts/get-token.ts <usernameA>
 *        SUPABASE_URL=... SUPABASE_ANON_KEY=... SIM_PASSWORD=<passwordB> npx tsx scripts/get-token.ts <usernameB>
 *
 *   2. Run the suite. Either let it create the match (needs SUPABASE_URL and
 *      SUPABASE_ANON_KEY too), or create a challenge in the lobby with account A
 *      and pass the id from the /match/<id> URL as MATCH_ID.
 *        TOKEN_A=... TOKEN_B=... MATCH_ID=<uuid> npx tsx scripts/attack-sim.ts
 *
 *      (PowerShell: $env:TOKEN_A="..."; $env:TOKEN_B="..."; $env:MATCH_ID="..."; npx tsx scripts/attack-sim.ts)
 *
 * Takes about 40-60 seconds (it plays real rounds, including the 5s prep).
 * =============================================================================
 */

import type { Socket } from 'socket.io-client';
import { createClient } from '@supabase/supabase-js';
import { connectLocalSocket, localFetch, parseLocalTarget, toLocalTarget, type LocalTarget } from './lib/localTarget';

// Re-exported for existing callers; the check itself lives in lib/localTarget.ts.
export { assertLocalhost } from './lib/localTarget';

export interface AttackOptions {
  /** Validated again here and at every connection, whatever the caller did. */
  url: string | LocalTarget;
  tokenA: string;
  tokenB: string;
  matchId: string;
  log?: (line: string) => void;
}

export interface Finding {
  id: string;
  attack: string;
  expected: string;
  observed: string;
  /** true = the server held; false = exploit worked; 'n/a' = could not be exercised here */
  defended: boolean | 'n/a';
}

type Tile = { value: number };
type RoundStart = { roundNumber: number; tiles: Tile[]; target: number; startTimestamp: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(target: LocalTarget, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connectLocalSocket(target, token);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(new Error(`could not connect: ${e.message}`)));
  });
}

async function waitUntil(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

/** Never throws; "no data" counts as "not seen". */
function recorder<T = any>(socket: Socket, event: string): T[] {
  const seen: T[] = [];
  socket.on(event, (p: T) => seen.push(p));
  return seen;
}

export async function runAttackSuite(opts: AttackOptions): Promise<Finding[]> {
  const target = toLocalTarget(opts.url);
  const log = opts.log ?? console.log;
  const findings: Finding[] = [];
  const record = (f: Finding) => {
    findings.push(f);
    const verdict = f.defended === 'n/a' ? 'N/A' : f.defended ? 'DEFENDED' : 'VULNERABLE  <<<<<<';
    log(`\n[${f.id}] ${f.attack}`);
    log(`   a defended server: ${f.expected}`);
    log(`   observed:          ${f.observed}`);
    log(`   => ${verdict}`);
  };

  const health = async () => {
    try {
      return (await localFetch(target, '/health')).ok;
    } catch {
      return false;
    }
  };

  let A = await connect(target, opts.tokenA);
  const B = await connect(target, opts.tokenB);

  // ── 1. Garbage barrage ────────────────────────────────────────────────────
  const garbage: unknown[] = [undefined, null, 'x', 42, [], [null], {}, { matchId: null }, { matchId: {} }];
  const events = ['join_room', 'cancel_room', 'submit_answer', 'player_status', 'request_rematch', 'rematch_response'];
  for (const payload of garbage) for (const ev of events) (A as any).emit(ev, payload);
  for (const steps of [null, 'x', [null], [1], { length: 1 }]) (A as any).emit('submit_answer', { steps });
  await sleep(1000);
  const alive = await health();
  const keptOpen = A.connected;
  record({
    id: 'S1',
    attack: 'Send ~65 malformed payloads (null, missing, wrong types) to every event',
    expected: 'server keeps running (an old build crashed on these); the abusive socket may be cut off',
    observed: `server ${alive ? 'still up' : 'DOWN'}; attacker socket ${keptOpen ? 'left open' : 'disconnected by the server'}`,
    defended: alive,
  });
  // Always continue on a fresh connection: the barrage spent this socket's per-event budgets
  // (which is itself the rate limiter doing its job), so a real join on it would be dropped.
  A.disconnect();
  A = await connect(target, opts.tokenA);

  // ── join the match ────────────────────────────────────────────────────────
  const aRoundStarts = recorder<RoundStart>(A, 'round_start');
  const bRoundStarts = recorder<RoundStart>(B, 'round_start');
  const aResults = recorder<any>(A, 'round_result');
  const aErrors = recorder<{ code: string; message: string }>(A, 'error');
  const bErrors = recorder<{ code: string; message: string }>(B, 'error');
  const bOffers = recorder(B, 'rematch_offer');

  A.emit('join_room', { matchId: opts.matchId });
  await sleep(300);
  B.emit('join_room', { matchId: opts.matchId });
  await waitUntil(() => aRoundStarts.length >= 1 && bRoundStarts.length >= 1, 15_000, 'round 1 to start');

  const add = (tiles: Tile[]) => {
    const [a, b] = tiles;
    return { steps: [{ a: a.value, op: '+', b: b.value, result: a.value + b.value }], resultValue: a.value + b.value };
  };
  const waitForGameplay = async (rs: RoundStart) => {
    const wait = rs.startTimestamp - Date.now();
    if (wait > 0) await sleep(wait + 80);
  };

  // ── Round 1: forged submission, then replay ──────────────────────────────
  const r1 = aRoundStarts[0];
  await waitForGameplay(r1);
  const forged = [{ a: r1.tiles[0].value, op: '?', b: r1.tiles[1].value }]; // unknown operator, no result field
  (A as any).emit('submit_answer', { steps: forged, resultValue: 1 }); // cheater goes FIRST (the old exploit won the speed tiebreak)
  await sleep(100);
  B.emit('submit_answer', add(r1.tiles));
  await waitUntil(() => aResults.length >= 1, 10_000, 'round 1 result');
  const rr1 = aResults[0];
  record({
    id: 'S2',
    attack: 'Submit a forged step (operator "?", no result) before the honest player answers',
    expected: 'forger scores 0 (no valid answer); honest player gets the +1.00 timeout win',
    observed: `forger result=${rr1.player1.result}, points=${rr1.player1.pointsRaw}; honest points=${rr1.player2.pointsRaw}`,
    defended: rr1.player1.result === null && rr1.player1.pointsRaw === 0 && rr1.player2.pointsRaw === 100,
  });

  // Replay: hammer submit_answer the instant the round has been scored.
  for (let i = 0; i < 30; i++) {
    (A as any).emit('submit_answer', add(r1.tiles));
    B.emit('submit_answer', add(r1.tiles));
  }
  await sleep(1500);
  const r1Copies = aResults.filter((r) => r.roundNumber === 1).length;
  record({
    id: 'S3',
    attack: '60 repeated submit_answer events right after the round was scored (try to re-score it)',
    expected: 'round 1 is scored exactly once',
    observed: `round_result for round 1 was delivered ${r1Copies} time(s)`,
    defended: r1Copies === 1,
  });

  // ── Round 2: early submit, then double submit ────────────────────────────
  await waitUntil(() => aRoundStarts.length >= 2 && bRoundStarts.length >= 2, 15_000, 'round 2 to start');
  const r2 = aRoundStarts[1];
  const prepLeft = r2.startTimestamp - Date.now();
  if (prepLeft > 1500) {
    const before = aErrors.length;
    A.emit('submit_answer', add(r2.tiles)); // tiles are on screen but gameplay has not started
    await sleep(700);
    const refused = aErrors.slice(before).some((e) => e.code === 'no_active_round');
    record({
      id: 'S4',
      attack: `Submit during the prep countdown (${(prepLeft / 1000).toFixed(1)}s before play starts) to bank a negative/zero time`,
      expected: 'refused with no_active_round',
      observed: refused ? 'error no_active_round received' : 'no error: the early answer was accepted',
      defended: refused,
    });
  } else {
    record({
      id: 'S4',
      attack: 'Submit during the prep countdown',
      expected: 'refused with no_active_round',
      observed: 'this server has no prep window (test mode); not exercised',
      defended: 'n/a',
    });
  }

  await waitForGameplay(r2);
  const [t0, t1, t2] = r2.tiles;
  const first = add(r2.tiles); // t0 + t1
  const second = {
    steps: [
      { a: t0.value, op: '+', b: t1.value, result: t0.value + t1.value },
      { a: t0.value + t1.value, op: '+', b: t2.value, result: t0.value + t1.value + t2.value },
    ],
    resultValue: 0,
  };
  const before = aResults.length;
  A.emit('submit_answer', first);
  A.emit('submit_answer', second); // "double click" with a DIFFERENT answer
  await sleep(300);
  B.emit('submit_answer', add(r2.tiles));
  await waitUntil(() => aResults.length > before, 10_000, 'round 2 result');
  const rr2 = aResults[aResults.length - 1];
  record({
    id: 'S5',
    attack: 'Submit twice in a row with different answers (change your mind after the first)',
    expected: 'the first submission is final',
    observed: `scored result=${rr2.player1.result} (first=${first.resultValue}, second=${t0.value + t1.value + t2.value})`,
    defended: rr2.player1.result === first.resultValue,
  });

  // ── Round 3: erase the match, mid-match rematch ──────────────────────────
  await waitUntil(() => aRoundStarts.length >= 3 && bRoundStarts.length >= 3, 15_000, 'round 3 to start');
  const bErrBefore = bErrors.length;
  (A as any).emit('cancel_room', { matchId: opts.matchId }); // what a losing host would do to dodge the loss
  await sleep(1500);
  const erased = bErrors.slice(bErrBefore).some((e) => /cancel/i.test(e.message));
  record({
    id: 'S6',
    attack: 'Losing host emits cancel_room in the middle of the match to erase it',
    expected: 'ignored; the opponent is NOT told the match was cancelled (leaving = forfeit after the 15s grace)',
    observed: erased ? 'opponent was told "The host has cancelled the match"' : 'nothing happened; match continues',
    defended: !erased,
  });

  (A as any).emit('request_rematch', { matchId: opts.matchId });
  await sleep(1500);
  record({
    id: 'S7',
    attack: 'Request a rematch while the match is still being played',
    expected: 'ignored; the opponent gets no rematch offer',
    observed: bOffers.length === 0 ? 'no offer delivered' : `${bOffers.length} rematch offer(s) delivered`,
    defended: bOffers.length === 0,
  });

  A.disconnect();
  B.disconnect();
  // Deliberately NOT waiting out the grace period: both players leaving together discards
  // the match without a result, so no wins/losses/MMR are changed on your test accounts.
  return findings;
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function createMatch(tokenA: string): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('Set MATCH_ID, or set SUPABASE_URL and SUPABASE_ANON_KEY so the script can create the match as account A.');
  }
  const sb = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${tokenA}` } },
  });
  const { data: user, error: userErr } = await sb.auth.getUser(tokenA);
  if (userErr || !user.user) throw new Error(`token A is not valid: ${userErr?.message ?? 'no user'}`);
  const { data, error } = await sb.from('matches').insert({ player1_id: user.user.id, status: 'pending' }).select('id').single();
  if (error || !data?.id) throw new Error(`could not create match: ${error?.message}`);
  return data.id;
}

async function main() {
  const target = parseLocalTarget(process.env.SERVER_URL ?? 'http://localhost:4000');
  const tokenA = process.env.TOKEN_A;
  const tokenB = process.env.TOKEN_B;
  if (!tokenA || !tokenB) {
    console.error('Set TOKEN_A and TOKEN_B (see the usage notes at the top of this file).');
    process.exit(2);
  }
  const matchId = process.env.MATCH_ID ?? (await createMatch(tokenA));
  console.log(`Attacking ${target.origin}, match ${matchId}\n(takes about a minute: it plays real rounds)`);

  const findings = await runAttackSuite({ url: target, tokenA, tokenB, matchId });

  const vulnerable = findings.filter((f) => f.defended === false);
  console.log('\n──────────────── SUMMARY ────────────────');
  for (const f of findings) {
    console.log(`${f.id}  ${f.defended === 'n/a' ? 'N/A     ' : f.defended ? 'DEFENDED ' : 'VULNERABLE'}  ${f.attack}`);
  }
  console.log(vulnerable.length === 0 ? '\nAll exercised attacks were blocked.' : `\n${vulnerable.length} attack(s) SUCCEEDED.`);
  process.exit(vulnerable.length === 0 ? 0 : 1);
}

// Only run as a CLI, not when imported by the tests.
if (process.argv[1] && /attack-sim\.[tj]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(2);
  });
}
