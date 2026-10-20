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

async function main() {
  const [identifier, extra] = process.argv.slice(2);
  if (extra !== undefined) {
    console.error('Do not pass the password as an argument (it lands in shell history). Set SIM_PASSWORD instead.');
    process.exit(2);
  }
  const password = process.env.SIM_PASSWORD;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!identifier || !password || !url || !anon) {
    console.error('Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SIM_PASSWORD=... npx tsx scripts/get-token.ts <username-or-email>');
    process.exit(2);
  }
  const email = identifier.includes('@') ? identifier : `${identifier}@players.countdown.app`;
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error(`Sign-in failed: ${error?.message ?? 'no session returned'}`);
    process.exit(1);
  }
  console.log(data.session.access_token);
}

main();
