/**
 * Prints a Supabase access token for a test account so the simulation scripts
 * can act as that player. Tokens expire after about an hour. Treat the output
 * like a password: it IS a login for that account. Do not paste it anywhere.
 *
 * Usage (from countdown-server/):
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=<anon key> \
 *     npx tsx scripts/get-token.ts <username-or-email> <password>
 *
 * A bare username gets the same synthetic email the app uses when you register
 * with a username (<username>@players.countdown.app).
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  const [identifier, password] = process.argv.slice(2);
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!identifier || !password || !url || !anon) {
    console.error('Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/get-token.ts <username-or-email> <password>');
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
