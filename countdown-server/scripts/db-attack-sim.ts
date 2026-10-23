/**
 * =============================================================================
 * FILE: scripts/db-attack-sim.ts
 * PURPOSE: Attack YOUR Supabase project exactly the way a player could from the
 * browser console: with the public anon key and their own login. Each check
 * prints ALLOWED or BLOCKED, what a locked-down database should say, and which
 * lockdown step closes it. Run it before docs/sql/2026-10-21-lockdown-a.sql to
 * see the holes, and again after each step to prove they are closed.
 *
 * It also runs a few LEGIT checks (reading your own profile, creating and
 * cancelling a challenge): those must stay ALLOWED, so an over-tight lockdown
 * shows up here too.
 *
 * SAFETY
 *   - Use two THROWAWAY accounts (A and B). Never your real one.
 *   - Uses only the anon/publishable key. It refuses a service-role or secret
 *     key, because that key bypasses every policy and would make every check
 *     look ALLOWED (and is far too powerful to paste around).
 *   - Anything it changes on account A (MMR, wins, username) it changes back.
 *   - Match rows it creates are deleted when the database allows it; any that
 *     can't be (the database has no delete policy before step A) are listed at
 *     the end with the exact SQL to remove them. Pending ones are also removed
 *     by the stale-match sweeper after 30 minutes once step A is applied.
 *
 * USAGE (from countdown-server/)
 *   CAPTCHA is on, so get each account's token from the browser instead of
 *   get-token.ts: log in as the account, open DevTools > Console on the app and
 *   paste the snippet in the "GETTING A TOKEN" block below. It copies the token.
 *
 *   PowerShell:
 *     $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="<anon key>"
 *     $env:TOKEN_A="<token of throwaway A>"; $env:TOKEN_B="<token of throwaway B>"
 *     npx tsx scripts/db-attack-sim.ts
 *
 * GETTING A TOKEN (browser console, while logged in as that account):
 *   (() => { const raw = document.cookie.split('; ').filter(c => /^sb-.*-auth-token(\.\d+)?=/.test(c)).sort()
 *     .map(c => c.slice(c.indexOf('=') + 1)).join(''); const v = decodeURIComponent(raw);
 *     const json = v.startsWith('base64-') ? atob(v.slice(7).replace(/-/g, '+').replace(/_/g, '/')) : v;
 *     copy(JSON.parse(json).access_token); return 'token copied'; })()
 *   (If that fails, switch CAPTCHA off for a minute and use scripts/get-token.ts.)
 * =============================================================================
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Outcome = 'ALLOWED' | 'BLOCKED' | 'SKIPPED' | 'ERROR';

export interface CheckResult {
  id: string;
  title: string;
  /** What a fully locked-down database must answer. */
  expected: 'ALLOWED' | 'BLOCKED';
  /** Which file closes (or, for LEGIT checks, must keep) this. */
  closedBy: string;
  outcome: Outcome;
  detail: string;
}

/**
 * Cleans a value pasted from a terminal or browser: trims whitespace and line
 * breaks (a token pasted across two lines otherwise ends with a newline, which
 * is an invalid HTTP header) and strips one pair of wrapping quotes. Returns
 * undefined for empty input.
 */
export function cleanSecret(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Reads the email and expiry out of a login token WITHOUT verifying it (the
 * payload is only base64), so errors can name the account and say "expired"
 * instead of a vague "invalid". Never trust the result for anything else.
 */
export function describeToken(
  token: string,
  nowMs: number = Date.now()
): { email?: string; expiresAt?: Date; expired: boolean } {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    const expiresAt = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined;
    return {
      email: typeof payload.email === 'string' ? payload.email : undefined,
      expiresAt,
      expired: expiresAt ? expiresAt.getTime() <= nowMs : false,
    };
  } catch {
    return { expired: false };
  }
}

/**
 * Refuses keys that bypass Row Level Security. A legacy JWT key carries its role
 * in the payload; the newer keys carry it in the prefix (sb_secret_ vs
 * sb_publishable_).
 */
export function assertPublicKey(key: string): void {
  if (key.startsWith('sb_secret_')) {
    throw new Error('Refusing: that is a SECRET key. Use the anon / publishable key.');
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    let role: unknown;
    try {
      role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role;
    } catch {
      return; // not a JWT we can read; Supabase itself will reject it if it is invalid
    }
    if (role === 'service_role') {
      throw new Error('Refusing: that is the SERVICE ROLE key. It bypasses every policy. Use the anon key.');
    }
  }
}

/** Formats the final table and the clean-up SQL for rows the database would not let us delete. */
export function formatReport(results: CheckResult[], leftoverMatchIds: string[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('──────────────────────────── SUMMARY ────────────────────────────');
  for (const r of results) {
    const flag =
      r.outcome === r.expected ? 'ok  ' : r.outcome === 'SKIPPED' || r.outcome === 'ERROR' ? '??  ' : 'OPEN';
    lines.push(`${flag} ${r.id.padEnd(4)} ${r.outcome.padEnd(8)} (should be ${r.expected.padEnd(7)}, ${r.closedBy})  ${r.title}`);
  }
  const open = results.filter((r) => r.expected === 'BLOCKED' && r.outcome === 'ALLOWED');
  const broken = results.filter((r) => r.expected === 'ALLOWED' && r.outcome === 'BLOCKED');
  lines.push('');
  lines.push(open.length === 0 ? 'No holes found.' : `${open.length} hole(s) still OPEN.`);
  if (broken.length > 0) lines.push(`${broken.length} legitimate action(s) are BLOCKED: the app may be broken.`);
  if (leftoverMatchIds.length > 0) {
    lines.push('');
    lines.push('Test match rows the database did not let the script delete. Remove them in the SQL editor:');
    lines.push(
      `  delete from public.matches where id in (${leftoverMatchIds.map((id) => `'${id}'`).join(', ')})` +
        `\n    and not exists (select 1 from public.rounds r where r.match_id = matches.id);`
    );
  }
  return lines.join('\n');
}

function clientFor(url: string, anonKey: string, token?: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

function errText(e: { message?: string; code?: string } | null | undefined): string {
  return e ? `${e.code ?? ''} ${e.message ?? ''}`.trim() : '';
}

export async function runDbAttacks(opts: {
  url: string;
  anonKey: string;
  tokenA: string;
  tokenB: string;
  log?: (line: string) => void;
}): Promise<{ results: CheckResult[]; leftoverMatchIds: string[] }> {
  assertPublicKey(opts.anonKey);
  const log = opts.log ?? console.log;
  const anon = clientFor(opts.url, opts.anonKey);
  const A = clientFor(opts.url, opts.anonKey, opts.tokenA);
  const B = clientFor(opts.url, opts.anonKey, opts.tokenB);

  // Say WHICH token is wrong and why, before spending a network call on it.
  for (const [label, token] of [['TOKEN_A', opts.tokenA], ['TOKEN_B', opts.tokenB]] as const) {
    const d = describeToken(token);
    if (d.expired && d.expiresAt) {
      throw new Error(
        `${label} expired at ${d.expiresAt.toISOString()} (${d.email ?? 'unknown account'}). ` +
          'Login tokens last about an hour: log in again and copy a fresh one.'
      );
    }
  }
  const ua = await A.auth.getUser(opts.tokenA);
  if (!ua.data.user) throw new Error(`TOKEN_A was rejected by Supabase: ${ua.error?.message ?? 'no user returned'}`);
  const ub = await B.auth.getUser(opts.tokenB);
  if (!ub.data.user) throw new Error(`TOKEN_B was rejected by Supabase: ${ub.error?.message ?? 'no user returned'}`);
  const idA = ua.data.user.id;
  const idB = ub.data.user.id;
  const emailA = ua.data.user.email ?? idA;
  const emailB = ub.data.user.email ?? idB;
  log(`Account A: ${emailA}
Account B: ${emailB}
`);
  if (idA === idB) {
    throw new Error(
      `TOKEN_A and TOKEN_B are both for ${emailA}. Log in as a DIFFERENT account for the second token ` +
        '(use an incognito window so the two logins do not share a session).'
    );
  }

  const results: CheckResult[] = [];
  const created = new Set<string>();
  const record = (r: CheckResult) => {
    results.push(r);
    log(`[${r.id}] ${r.outcome.padEnd(8)} ${r.title}${r.detail ? `\n       ${r.detail}` : ''}`);
  };
  const guard = async (base: Omit<CheckResult, 'outcome' | 'detail'>, fn: () => Promise<Pick<CheckResult, 'outcome' | 'detail'>>) => {
    try {
      record({ ...base, ...(await fn()) });
    } catch (e) {
      record({ ...base, outcome: 'ERROR', detail: String((e as Error)?.message ?? e) });
    }
  };

  // Account A's starting values, so every change can be put back.
  const before = await A.from('profiles').select('username, mmr, wins').eq('id', idA).maybeSingle();
  const original = before.data as { username: string | null; mmr: number; wins: number } | null;

  // ── LEGIT: must stay allowed ────────────────────────────────────────────
  await guard({ id: 'L1', title: 'LEGIT read your own username and MMR', expected: 'ALLOWED', closedBy: 'must stay' }, async () => ({
    outcome: original ? 'ALLOWED' : 'BLOCKED',
    detail: original ? '' : errText(before.error) || 'no row returned',
  }));

  await guard({ id: 'L2', title: "LEGIT read an opponent's username and MMR", expected: 'ALLOWED', closedBy: 'must stay' }, async () => {
    const { data, error } = await A.from('profiles').select('username, mmr').eq('id', idB).maybeSingle();
    return { outcome: data ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  // ── Reading private data ────────────────────────────────────────────────
  await guard({ id: 'X1', title: 'Logged OUT: read players\' emails with only the anon key', expected: 'BLOCKED', closedBy: 'lockdown-c1' }, async () => {
    const { data, error } = await anon.from('profiles').select('id, email').limit(3);
    const n = (data ?? []).filter((r: { email?: string }) => r.email).length;
    return { outcome: n > 0 ? 'ALLOWED' : 'BLOCKED', detail: n > 0 ? `read ${n} email(s) without logging in` : errText(error) };
  });

  await guard({ id: 'X2', title: "Logged in: read another player's email", expected: 'BLOCKED', closedBy: 'lockdown-c1' }, async () => {
    const { data, error } = await A.from('profiles').select('email').eq('id', idB).maybeSingle();
    const email = (data as { email?: string } | null)?.email;
    return { outcome: email ? 'ALLOWED' : 'BLOCKED', detail: email ? "got B's email" : errText(error) };
  });

  await guard({ id: 'X3', title: 'Logged OUT: list matches', expected: 'BLOCKED', closedBy: 'already' }, async () => {
    const { data, error } = await anon.from('matches').select('id').limit(3);
    return { outcome: (data ?? []).length > 0 ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  // ── Editing your own record ─────────────────────────────────────────────
  const tryOwnEdit = async (column: 'mmr' | 'wins', value: number, restore: number) => {
    const { data, error } = await A.from('profiles').update({ [column]: value }).eq('id', idA).select(column);
    const changed = (data ?? []).length > 0 && (data![0] as Record<string, number>)[column] === value;
    if (changed) {
      const back = await A.from('profiles').update({ [column]: restore }).eq('id', idA).select(column);
      if ((back.data ?? []).length === 0) {
        log(`       WARNING: could not put ${column} back to ${restore}. Run: update public.profiles set ${column} = ${restore} where id = '${idA}';`);
      }
    }
    return { outcome: (changed ? 'ALLOWED' : 'BLOCKED') as Outcome, detail: changed ? `set own ${column} to ${value} (put back to ${restore})` : errText(error) };
  };

  await guard({ id: 'X4', title: 'Set your own MMR to anything', expected: 'BLOCKED', closedBy: 'lockdown-c2' }, async () =>
    original ? tryOwnEdit('mmr', original.mmr + 777, original.mmr) : { outcome: 'SKIPPED', detail: 'could not read own profile' }
  );

  await guard({ id: 'X5', title: 'Set your own win count', expected: 'BLOCKED', closedBy: 'lockdown-c2' }, async () =>
    original ? tryOwnEdit('wins', original.wins + 50, original.wins) : { outcome: 'SKIPPED', detail: 'could not read own profile' }
  );

  const tryRename = async (to: string) => {
    if (!original?.username) return { outcome: 'SKIPPED' as Outcome, detail: 'account A has no username yet; pick one in the app first' };
    const { data, error } = await A.from('profiles').update({ username: to }).eq('id', idA).select('username');
    const changed = (data ?? []).length > 0 && (data![0] as { username: string }).username === to;
    if (changed) {
      const back = await A.from('profiles').update({ username: original.username }).eq('id', idA).select('username');
      if ((back.data ?? []).length === 0) {
        log(`       WARNING: could not restore the username. Run: update public.profiles set username = '${original.username}' where id = '${idA}';`);
      }
    }
    return { outcome: (changed ? 'ALLOWED' : 'BLOCKED') as Outcome, detail: changed ? `renamed to "${to}" (put back)` : errText(error) };
  };

  await guard({ id: 'X6', title: 'Change your username after it was set', expected: 'BLOCKED', closedBy: 'lockdown-a' }, async () =>
    tryRename(`${(original?.username ?? 'x').slice(0, 15)}_alt9`)
  );

  await guard({ id: 'X7', title: 'Take a reserved name ("Moderator")', expected: 'BLOCKED', closedBy: 'lockdown-a' }, async () =>
    tryRename('Moderator')
  );

  // ── Matches ─────────────────────────────────────────────────────────────
  await guard({ id: 'X8', title: 'Create a match that is already "completed" with 500 points', expected: 'BLOCKED', closedBy: 'lockdown-a' }, async () => {
    const { data, error } = await A.from('matches')
      .insert({ player1_id: idA, status: 'completed', player1_total_points: 500 })
      .select('id');
    const id = (data ?? [])[0]?.id as string | undefined;
    if (id) created.add(id);
    return { outcome: id ? 'ALLOWED' : 'BLOCKED', detail: id ? 'inserted a fake completed match' : errText(error) };
  });

  let legitMatch: string | undefined;
  await guard({ id: 'L3', title: 'LEGIT create one open challenge', expected: 'ALLOWED', closedBy: 'must stay' }, async () => {
    const { data, error } = await A.from('matches').insert({ player1_id: idA, status: 'pending' }).select('id');
    legitMatch = (data ?? [])[0]?.id;
    if (legitMatch) created.add(legitMatch);
    return { outcome: legitMatch ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  await guard({ id: 'X9', title: 'Make yourself the winner of your own match', expected: 'BLOCKED', closedBy: 'already' }, async () => {
    if (!legitMatch) return { outcome: 'SKIPPED', detail: 'no match from L3' };
    const { data, error } = await A.from('matches').update({ winner_id: idA, status: 'completed' }).eq('id', legitMatch).select('id');
    return { outcome: (data ?? []).length > 0 ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  await guard({ id: 'X10', title: 'Write a fake round into your match', expected: 'BLOCKED', closedBy: 'already' }, async () => {
    if (!legitMatch) return { outcome: 'SKIPPED', detail: 'no match from L3' };
    const { data, error } = await A.from('rounds')
      .insert({
        match_id: legitMatch, round_number: 1, target: 100, tiles: [], solvable: true,
        player1_points: 100, player2_points: 0, player1_outcome: 'win', player2_outcome: 'loss',
      })
      .select('id');
    return { outcome: (data ?? []).length > 0 ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  await guard({ id: 'X11', title: 'Call finish_match yourself to award a win', expected: 'BLOCKED', closedBy: 'already' }, async () => {
    if (!legitMatch) return { outcome: 'SKIPPED', detail: 'no match from L3' };
    const { error } = await A.rpc('finish_match', {
      p_match_id: legitMatch, p_winner_id: idA, p_loser_id: idB, p_winner_score: 500, p_loser_score: 0,
    });
    return { outcome: error ? 'BLOCKED' : 'ALLOWED', detail: errText(error) };
  });

  // B creates a bait match with the column defaults (the old "waiting" status) so A can try the legacy join policy.
  await guard({ id: 'X12', title: "Join someone else's match directly, skipping the game server", expected: 'BLOCKED', closedBy: 'lockdown-a' }, async () => {
    const bait = await B.from('matches').insert({ player1_id: idB }).select('id');
    const baitId = (bait.data ?? [])[0]?.id as string | undefined;
    if (!baitId) return { outcome: 'BLOCKED', detail: `could not even create a default-status match (${errText(bait.error)})` };
    created.add(baitId);
    const { data, error } = await A.from('matches').update({ player2_id: idA, status: 'in_progress' }).eq('id', baitId).select('id');
    return { outcome: (data ?? []).length > 0 ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  await guard({ id: 'X13', title: "Delete another player's match", expected: 'BLOCKED', closedBy: 'already' }, async () => {
    const theirs = await B.from('matches').insert({ player1_id: idB, status: 'pending' }).select('id');
    const theirId = (theirs.data ?? [])[0]?.id as string | undefined;
    if (!theirId) return { outcome: 'SKIPPED', detail: `B could not create a match (${errText(theirs.error)})` };
    created.add(theirId);
    const { data, error } = await A.from('matches').delete().eq('id', theirId).select('id');
    const gone = (data ?? []).length > 0;
    if (gone) created.delete(theirId);
    return { outcome: gone ? 'ALLOWED' : 'BLOCKED', detail: errText(error) };
  });

  await guard({ id: 'X14', title: 'Flood: create 10 open challenges in a row', expected: 'BLOCKED', closedBy: 'lockdown-a' }, async () => {
    let made = 0;
    let lastError = '';
    for (let i = 0; i < 10; i++) {
      const { data, error } = await A.from('matches').insert({ player1_id: idA, status: 'pending' }).select('id');
      const id = (data ?? [])[0]?.id as string | undefined;
      if (id) {
        created.add(id);
        made++;
      } else {
        lastError = errText(error);
      }
    }
    // "BLOCKED" here means the cap stopped it (3 open challenges, including L3's).
    return { outcome: made >= 10 ? 'ALLOWED' : 'BLOCKED', detail: `${made} of 10 created${lastError ? `; then: ${lastError}` : ''}` };
  });

  await guard({ id: 'L4', title: 'LEGIT cancel your own open challenge', expected: 'ALLOWED', closedBy: 'lockdown-a fixes' }, async () => {
    if (!legitMatch) return { outcome: 'SKIPPED', detail: 'no match from L3' };
    const { data, error } = await A.from('matches').delete().eq('id', legitMatch).select('id');
    const gone = (data ?? []).length > 0;
    if (gone) created.delete(legitMatch);
    return {
      outcome: gone ? 'ALLOWED' : 'BLOCKED',
      detail: gone ? '' : errText(error) || 'no delete policy: the lobby Cancel button silently does nothing',
    };
  });

  // ── Clean up whatever we can, as the account that owns it ──────────────
  for (const id of [...created]) {
    for (const client of [A, B]) {
      const { data } = await client.from('matches').delete().eq('id', id).select('id');
      if ((data ?? []).length > 0) {
        created.delete(id);
        break;
      }
    }
  }

  return { results, leftoverMatchIds: [...created] };
}

async function main() {
  const url = cleanSecret(process.env.SUPABASE_URL);
  const anonKey = cleanSecret(process.env.SUPABASE_ANON_KEY);
  const tokenA = cleanSecret(process.env.TOKEN_A);
  const tokenB = cleanSecret(process.env.TOKEN_B);
  if (!url || !anonKey || !tokenA || !tokenB) {
    console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TOKEN_A and TOKEN_B (see the top of this file).');
    process.exit(2);
  }
  console.log(`Attacking ${new URL(url).host} as two throwaway players...\n`);
  const { results, leftoverMatchIds } = await runDbAttacks({ url, anonKey, tokenA, tokenB });
  console.log(formatReport(results, leftoverMatchIds));
  process.exit(results.some((r) => r.expected === 'BLOCKED' && r.outcome === 'ALLOWED') ? 1 : 0);
}

if (process.argv[1] && /db-attack-sim\.[tj]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(2);
  });
}
