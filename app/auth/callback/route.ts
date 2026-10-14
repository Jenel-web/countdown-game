import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /auth/callback
 *
 * Supabase redirects here after the Google OAuth consent screen.
 * This route handler:
 *   1. Exchanges the one-time `code` for a Supabase session (sets cookies).
 *   2. Ensures a `profiles` row exists for the newly authenticated user
 *      without overwriting any existing MMR / win-loss / match-history data.
 *   3. Redirects the user to /choose-username if their profile has no
 *      username yet, otherwise to /lobby. On failure, back to /login with an
 *      error message.
 *
 * Security notes:
 *   - The `code` param is a one-time, short-lived value issued by Supabase.
 *   - We never expose the service-role key here; the browser anon key is
 *     sufficient because RLS policies on `profiles` allow a user to upsert
 *     their own row.
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

  // Ensure a profiles row exists for the user.
  // `upsert` with `ignoreDuplicates: true` (equivalent to ON CONFLICT DO NOTHING)
  // guarantees we never overwrite MMR, wins, losses, or match history for a
  // returning user — only a brand-new row is inserted.
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        // Use the Google-provided email. For returning users this column value
        // is already correct, so re-sending it is harmless.
        email: user.email ?? null,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: true, // never touch existing rows
      }
    );

  if (profileError) {
    // A profile sync failure is non-fatal for sign-in, but we log it so it
    // shows up in server logs / Supabase log drain.
    console.warn('[auth/callback] Profile upsert warning:', profileError.message);
  }

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
