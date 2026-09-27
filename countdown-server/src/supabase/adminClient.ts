/**
 * =============================================================================
 * FILE: src/supabase/adminClient.ts
 * RESPONSIBILITY: Create ONE Supabase client for the whole server to share,
 * authenticated with the SERVICE ROLE KEY instead of the public "anon" key.
 *
 * BEGINNER NOTE — why this client is different from your Next.js app's:
 * Your Next.js app's browser client uses the "anon" key, which is subject
 * to every Row Level Security (RLS) policy you wrote in Supabase — a real
 * player can only ever read/write the specific rows their policies allow.
 *
 * This server needs to do things NO individual player should ever be able
 * to do directly — like setting `player2_id` on a match between two OTHER
 * people, writing round results, or updating someone else's win/loss
 * record. The SERVICE ROLE KEY bypasses RLS entirely, for every table.
 * That's exactly why it must:
 *   1. NEVER be sent to a browser (no NEXT_PUBLIC_ prefix, ever, anywhere)
 *   2. NEVER be committed to git (it lives only in this server's .env)
 *   3. Only be used inside trusted, server-side code like this file
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config'; // loads .env into process.env as a side effect

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fail loudly and immediately at startup rather than limping along and
// producing confusing errors later, deep inside some event handler.
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — the server cannot start without these. Check your .env file against .env\'s template comments.'
  );
}

/**
 * The single shared admin client. Import this wherever the server needs to
 * read or write Supabase data, e.g.:
 *   adminClient.from('matches').update({ ... })
 *   adminClient.auth.getUser(token)
 *   adminClient.rpc('finish_match', { ... })
 */
export const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    // This client lives on a server, not in a browser — there's no
    // localStorage here to persist a session to, and no reason to
    // auto-refresh a token the way a browser client would. Both of these
    // browser-oriented behaviors are explicitly turned off.
    autoRefreshToken: false,
    persistSession: false,
  },
});