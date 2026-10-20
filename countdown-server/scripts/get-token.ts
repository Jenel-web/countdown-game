/**
 * Prints a Supabase access token for a test account so the simulation scripts
 * can act as that player. Tokens expire after about an hour. Treat the output
 * like a password: it IS a login for that account. Do not paste it anywhere.
 *
 * Usage (from countdown-server/):
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=<anon key> SIM_PASSWORD=<password> \
 *     npx tsx scripts/get-token.ts <username-or-email>
 *
 *   PowerShell:
 *     $env:SUPABASE_URL="..."; $env:SUPABASE_ANON_KEY="..."; $env:SIM_PASSWORD="..."
 *     npx tsx scripts/get-token.ts <username-or-email>
 *
 * The password comes from SIM_PASSWORD, never the command line: arguments end up
 * in shell history and are visible to other processes on the machine.
 *
 * A bare username gets the same synthetic email the app uses when you register
 * with a username (<username>@players.countdown.app).
 */

import { createClient } from '@supabase/supabase-js';

export interface Credentials {
  email: string;
  password: string;
  supabaseUrl: string;
  anonKey: string;
}

export const USAGE =
  'Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SIM_PASSWORD=... npx tsx scripts/get-token.ts <username-or-email>';
export const ARGV_PASSWORD_REFUSAL =
  'Do not pass the password as an argument (it lands in shell history). Set SIM_PASSWORD instead.';

/**
 * Decides what to sign in with, from the command-line arguments (after the
 * script name) and the environment. Pure: no I/O, so it is tested directly.
 * Any second argument is refused outright, whatever it is - a password typed
 * there has already leaked into shell history, and guessing whether it "looks
 * like" a password would let some through.
 */
export function readCredentials(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): { ok: true; credentials: Credentials } | { ok: false; message: string } {
  const [identifier, ...extra] = args;
  if (extra.length > 0) return { ok: false, message: ARGV_PASSWORD_REFUSAL };

  const password = env.SIM_PASSWORD;
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!identifier || !password || !supabaseUrl || !anonKey) return { ok: false, message: USAGE };

  const email = identifier.includes('@') ? identifier : `${identifier}@players.countdown.app`;
  return { ok: true, credentials: { email, password, supabaseUrl, anonKey } };
}

async function main() {
  const parsed = readCredentials(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exit(2);
  }
  const { email, password, supabaseUrl, anonKey } = parsed.credentials;
  const sb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error(`Sign-in failed: ${error?.message ?? 'no session returned'}`);
    process.exit(1);
  }
  console.log(data.session.access_token);
}

// Only run as a CLI, not when imported by the tests.
if (process.argv[1] && /get-token\.[tj]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(2);
  });
}
