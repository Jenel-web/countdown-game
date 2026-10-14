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

  it('redirects to /lobby and upserts profile on successful exchange', async () => {
    const fakeUser = { id: 'user-123', email: 'player@example.com' };
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: fakeUser, session: {} },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { username: 'Player1' } });

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/lobby$/);

    // Profile upsert must have been called with the correct data and
    // ignoreDuplicates: true so returning users' data is never overwritten
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-123', email: 'player@example.com' }),
      expect.objectContaining({ onConflict: 'id', ignoreDuplicates: true })
    );
  });

  it('still redirects to /lobby even when the profile upsert fails (non-fatal)', async () => {
    const fakeUser = { id: 'user-456', email: 'other@example.com' };
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: fakeUser, session: {} },
      error: null,
    });
    // Simulate a profile upsert failure
    mockUpsert.mockResolvedValueOnce({ error: { message: 'some db error' } });
    mockMaybeSingle.mockResolvedValueOnce({ data: { username: 'Other' } });

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req as any);

    // Sign-in still succeeds — profile sync failure is logged but not fatal
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/lobby$/);
  });

  it('redirects to /choose-username when the profile has no username yet', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { user: { id: 'user-789', email: 'new@gmail.com' }, session: {} },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { username: null } });

    const res = await GET(makeRequest({ code: 'valid-code' }) as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/choose-username$/);
  });
});
