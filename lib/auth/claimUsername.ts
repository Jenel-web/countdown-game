import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUsername } from './username';

export type ClaimResult = { ok: true } | { ok: false; error: string };

/** True when no profile already uses this name (case-insensitive). */
export async function isUsernameAvailable(
  supabase: SupabaseClient,
  name: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', name.trim().replace(/[\\%_]/g, '\\$&'))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length === 0;
}

/**
 * Saves the username on the player's own profile. The unique index on
 * lower(username) is the real guard against duplicates, so two players
 * racing for the same name still get a clean "taken" error.
 */
export async function claimUsername(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<ClaimResult> {
  const invalid = validateUsername(name);
  if (invalid) return { ok: false, error: invalid };

  const { data, error } = await supabase
    .from('profiles')
    .update({ username: name.trim() })
    .eq('id', userId)
    .is('username', null)
    .select('id');

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: 'Could not save your username. Please try again.' };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Could not find your profile, or a username is already set.' };
  }
  return { ok: true };
}
