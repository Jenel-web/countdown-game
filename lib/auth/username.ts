export const USERNAME_EMAIL_DOMAIN = 'players.countdown.app';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Returns an error message, or null when the username is valid. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (!USERNAME_PATTERN.test(trimmed.toLowerCase())) {
    return 'Username must be 3-20 characters: letters, numbers and underscore only.';
  }
  return null;
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
