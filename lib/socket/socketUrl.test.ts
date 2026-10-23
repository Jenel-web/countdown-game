import { describe, it, expect } from 'vitest';
import { DEV_SOCKET_URL, resolveSocketUrl } from './socketUrl';

describe('resolveSocketUrl', () => {
  it('uses the configured address, reduced to its origin', () => {
    expect(resolveSocketUrl('https://game.onrender.com', 'production')).toBe('https://game.onrender.com');
    expect(resolveSocketUrl('https://game.onrender.com/', 'production')).toBe('https://game.onrender.com');
    expect(resolveSocketUrl('  http://localhost:4000  ', 'development')).toBe('http://localhost:4000');
  });

  it('drops a path, which socket.io would otherwise read as a namespace', () => {
    expect(resolveSocketUrl('https://game.onrender.com/socket.io/', 'production')).toBe('https://game.onrender.com');
  });

  it('falls back to the local server in development and test', () => {
    for (const env of ['development', 'test', undefined]) {
      expect(resolveSocketUrl(undefined, env)).toBe(DEV_SOCKET_URL);
      expect(resolveSocketUrl('', env)).toBe(DEV_SOCKET_URL);
      expect(resolveSocketUrl('   ', env)).toBe(DEV_SOCKET_URL);
    }
  });

  it('REFUSES to fall back to localhost in a production build, and says how to fix it', () => {
    for (const missing of [undefined, '', '  ']) {
      expect(() => resolveSocketUrl(missing, 'production')).toThrow(/NEXT_PUBLIC_SOCKET_URL is not set[\s\S]*rebuild/);
    }
  });

  it('rejects values that are not http(s) addresses', () => {
    expect(() => resolveSocketUrl('game server', 'production')).toThrow(/not a valid URL/);
    expect(() => resolveSocketUrl('ftp://game.example.com', 'production')).toThrow(/http/);
    expect(() => resolveSocketUrl('javascript:alert(1)', 'development')).toThrow();
  });

  it('keeps a mistyped value out of the error message beyond a short excerpt', () => {
    expect(() => resolveSocketUrl('x'.repeat(500), 'production')).toThrow();
    try {
      resolveSocketUrl('x'.repeat(500), 'production');
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(200);
    }
  });
});
