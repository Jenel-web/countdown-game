export const USERNAME_EMAIL_DOMAIN = 'players.countdown.app';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Names players may not claim (compared case-insensitively). */
export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'support',
  'staff',
  'system',
  'root',
  'countdown',
  'countdownarena',
  'arena',
  'official',
  'null',
  'undefined',
  'guest',
  'opponent',
  'you',
];

/** Returns an error message, or null when the username is valid. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (!USERNAME_PATTERN.test(trimmed.toLowerCase())) {
    return 'Username must be 3-20 characters: letters, numbers and underscore only.';
  }
  if (RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
    return 'That username is reserved. Please choose another.';
  }
  return null;
}

/**
 * Name to show for a player: their chosen username, falling back to the part
 * of the email before "@" for accounts that have not picked one yet.
 */
export function displayName(
  profile: { username?: string | null; email?: string | null } | null | undefined,
  fallback = 'Operative'
): string {
  if (profile?.username) return profile.username;
  const prefix = profile?.email?.split('@')[0];
  return prefix || fallback;
}

/** Supabase Auth needs an email, so usernames map to a synthetic one. */
export function usernameToEmail(name: string): string {
  return `${name.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

/** Inputs containing "@" are existing real-email accounts and are used as-is. */
export function loginIdentifierToEmail(input: string): string {
  const trimmed = input.trim();
  return trimmed.includes('@') ? trimmed : usernameToEmail(trimmed);
}
