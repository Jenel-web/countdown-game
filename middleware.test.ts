/**
 * Tests the login gate in middleware.ts with a fake Supabase client: who gets
 * through, who is sent to /login, and who is sent to pick a username.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// What the fake Supabase will report for the current test.
let currentUser: { id: string } | null = null;
let profile: { username: string | null } | null = { username: 'player_one' };
let profileError: { message: string } | null = null;
let profileLookups = 0;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            profileLookups++;
            return { data: profile, error: profileError };
          },
        }),
      }),
    }),
  }),
}));

import middleware from './middleware';

const call = (path: string) => middleware(new NextRequest(`http://localhost:3000${path}`));
const redirectedTo = (res: Response) => (res.status >= 300 && res.status < 400 ? new URL(res.headers.get('location')!).pathname : null);

beforeEach(() => {
  currentUser = null;
  profile = { username: 'player_one' };
  profileError = null;
  profileLookups = 0;
});

describe('logged out', () => {
  it.each(['/lobby', '/game', '/training', '/history', '/match/3f2b7a1e-8c4d-4e6f-9a10-1b2c3d4e5f60', '/match'])(
    'sends %s to /login',
    async (path) => {
      expect(redirectedTo(await call(path))).toBe('/login');
    }
  );

  it.each(['/', '/login', '/register', '/terms', '/privacy', '/choose-username', '/auth/callback'])('lets %s through', async (path) => {
    expect(redirectedTo(await call(path))).toBeNull();
  });

  it('does not protect look-alike paths', async () => {
    expect(redirectedTo(await call('/matchmaking'))).toBeNull();
    expect(redirectedTo(await call('/lobbyist'))).toBeNull();
  });

  it('never queries profiles for a visitor who is not logged in', async () => {
    await call('/lobby');
    expect(profileLookups).toBe(0);
  });
});

describe('logged in with a username', () => {
  beforeEach(() => {
    currentUser = { id: 'u1' };
  });

  it.each(['/lobby', '/game', '/training', '/history', '/match/abc'])('lets %s through', async (path) => {
    expect(redirectedTo(await call(path))).toBeNull();
  });
});

describe('logged in without a username (for example a new Google account)', () => {
  beforeEach(() => {
    currentUser = { id: 'u2' };
    profile = { username: null };
  });

  it.each(['/lobby', '/game', '/history', '/match/abc'])('sends %s to /choose-username', async (path) => {
    expect(redirectedTo(await call(path))).toBe('/choose-username');
  });

  it('an empty username counts as none', async () => {
    profile = { username: '' };
    expect(redirectedTo(await call('/match/abc'))).toBe('/choose-username');
  });

  it('a missing profile row counts as none', async () => {
    profile = null;
    expect(redirectedTo(await call('/lobby'))).toBe('/choose-username');
  });

  it('is not enforced on public pages (they must stay reachable, including /choose-username itself)', async () => {
    expect(redirectedTo(await call('/choose-username'))).toBeNull();
    expect(redirectedTo(await call('/'))).toBeNull();
    expect(profileLookups).toBe(0);
  });
});

describe('a database hiccup', () => {
  it('never traps a logged-in player: a failed profile lookup lets them through', async () => {
    currentUser = { id: 'u3' };
    profile = null;
    profileError = { message: 'connection reset' };
    expect(redirectedTo(await call('/match/abc'))).toBeNull();
    expect(redirectedTo(await call('/lobby'))).toBeNull();
  });
});
