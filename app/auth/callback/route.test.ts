/**
 * Unit tests for the /auth/callback Route Handler.
 *
 * These tests run with Vitest and do NOT require a live Supabase instance —
 * the Supabase client is fully mocked below.
 *
 * Run with:  npm test -- app/auth/callback/route.test.ts
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server so no real cookies / env vars are needed
// ---------------------------------------------------------------------------
const mockExchangeCodeForSession = vi.fn();
const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: () => ({
      upsert: mockUpsert,
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Import the Route Handler AFTER mocks are in place
// ---------------------------------------------------------------------------
import { GET } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost:3000/auth/callback');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('/auth/callback GET handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login with error when OAuth returns an error param', async () => {
    const req = makeRequest({ error: 'access_denied', error_description: 'User cancelled' });
    const res = await GET(req as any);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/\/login\?error=/);
    expect(location).toMatch(/cancelled/i);
  });

  it('redirects to /login with error when code param is missing', async () => {
    const req = makeRequest({});
    const res = await GET(req as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login\?error=/);
  });

  it('redirects to /login with error when exchangeCodeForSession fails', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid_grant' },
    });

    const req = makeRequest({ code: 'bad-code' });
    const res = await GET(req as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login\?error=/);
  });

  it('redirects to /lobby on successful exchange and never writes a profile row', async () => {
    const fakeUser = { id: 'user-123', email: 'player@example.com' };
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: fakeUser, session: {} },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: { username: 'Player1' } });

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/lobby$/);

    // The handle_new_user trigger creates the profiles row. The browser roles
    // may not insert profiles at all (docs/sql/2026-10-21-lockdown-c2.sql), so
    // a write here would fail - and would let a client choose its own stats.
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('a missing profile row sends the player to /choose-username instead of failing', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: { id: 'user-456', email: 'other@example.com' }, session: {} },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null });

    const res = await GET(makeRequest({ code: 'valid-code' }) as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/choose-username$/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects to /choose-username when the profile has no username yet', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: { id: 'user-789', email: 'new@gmail.com' }, session: {} },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: { username: null } });

    const res = await GET(makeRequest({ code: 'valid-code' }) as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/choose-username$/);
  });
});
