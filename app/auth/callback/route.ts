import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /auth/callback
 *
 * Supabase redirects here after the Google OAuth consent screen.
 * This route handler:
 *   1. Exchanges the one-time `code` for a Supabase session (sets cookies).
 *   2. Reads the player's username. (The `profiles` row itself is created by
 *      the database trigger handle_new_user when the account is created.)
 *   3. Redirects the user to /choose-username if their profile has no
 *      username yet, otherwise to /lobby. On failure, back to /login with an
 *      error message.
 *
 * Security notes:
 *   - The `code` param is a one-time, short-lived value issued by Supabase.
 *   - We never expose the service-role key here; the browser anon key is
 *     enough because this route only reads the player's own username.
 *   - `error` / `error_description` are logged server-side only; the client
 *     receives only a generic redirect to avoid leaking OAuth internals.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  // OAuth error returned by Google / Supabase (e.g. user cancelled)
  const oauthError = searchParams.get('error');
  if (oauthError) {
    const desc = searchParams.get('error_description') ?? oauthError;
    console.warn('[auth/callback] OAuth error:', desc);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Google sign-in was cancelled or failed. Please try again.')}`
    );
  }

  const code = searchParams.get('code');
  if (!code) {
    console.warn('[auth/callback] Missing code parameter');
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Authentication failed: missing code. Please try again.')}`
    );
  }

  const supabase = createClient();

  // Exchange the auth code for a user session and persist it in cookies
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData?.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', exchangeError?.message);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`
    );
  }

  const user = sessionData.user;

  // The profiles row is created by the database trigger handle_new_user when
  // the account is created, so nothing is written here. The browser roles are
  // not allowed to insert profile rows (docs/sql/2026-10-21-lockdown-c2.sql).

  // First-time (or not-yet-named) players must pick a username before playing.
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  if (!profileRow?.username) {
    return NextResponse.redirect(`${origin}/choose-username`);
  }

  // Success — send user into the game
  return NextResponse.redirect(`${origin}/lobby`);
}
