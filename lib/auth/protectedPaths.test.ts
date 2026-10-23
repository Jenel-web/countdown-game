import { describe, it, expect } from 'vitest';
import { isProtectedPath, PROTECTED_PATHS } from './protectedPaths';

describe('isProtectedPath', () => {
  it.each(['/lobby', '/game', '/training', '/history', '/match'])('protects %s', (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });

  it('protects pages underneath them, including the live match page', () => {
    expect(isProtectedPath('/match/3f2b7a1e-8c4d-4e6f-9a10-1b2c3d4e5f60')).toBe(true);
    expect(isProtectedPath('/history/')).toBe(true);
    expect(isProtectedPath('/lobby/anything/deeper')).toBe(true);
  });

  it.each(['/', '/login', '/register', '/choose-username', '/terms', '/privacy', '/auth/callback'])('leaves %s public', (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });

  it('matches whole path segments only: look-alike names are not protected by accident', () => {
    for (const p of ['/matchmaking', '/matches', '/gaming', '/lobbyist', '/historyx', '/training-faq']) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });

  it('is case sensitive like the routes themselves', () => {
    expect(isProtectedPath('/Match/abc')).toBe(false);
  });

  it('every protected base is a single lowercase segment starting with a slash', () => {
    for (const base of PROTECTED_PATHS) expect(base).toMatch(/^\/[a-z-]+$/);
  });
});
