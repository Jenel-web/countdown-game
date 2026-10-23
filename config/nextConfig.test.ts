/**
 * Loads next.config.js under different environments to check the build-time
 * gate: a bad deploy must FAIL on Vercel, stay a warning on a laptop, and a
 * service role key in a public variable must stop the build everywhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const root = path.resolve(__dirname, '..');
const nodeRequire = createRequire(path.join(root, 'package.json'));

function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;
}

const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  NEXT_PUBLIC_SOCKET_URL: 'https://game.onrender.com',
};

const KEYS = [...Object.keys(GOOD), 'VERCEL', 'CHECK_ENV_STRICT', 'CSP_ENFORCE', 'NEXT_PUBLIC_LEAK'];
let saved: Record<string, string | undefined>;

/** Fresh load of next.config.js with exactly this environment. */
function loadConfig(env: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  for (const id of Object.keys(nodeRequire.cache)) {
    if (id.startsWith(path.join(root, 'config')) || id === path.join(root, 'next.config.js')) delete nodeRequire.cache[id];
  }
  return nodeRequire('./next.config.js');
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('on Vercel', () => {
  it('a complete environment builds, with the security settings applied', async () => {
    const config = loadConfig({ ...GOOD, VERCEL: '1' });
    expect(config.poweredByHeader).toBe(false);
    expect(config.images).toEqual({ unoptimized: true });
    const rules = await config.headers();
    expect(rules[0].source).toBe('/:path*');
    expect(rules[0].headers.some((h: { key: string }) => h.key === 'X-Frame-Options')).toBe(true);
  });

  it.each([
    ['no game server address', { NEXT_PUBLIC_SOCKET_URL: undefined }, /NEXT_PUBLIC_SOCKET_URL is not set/],
    ['an http game server address', { NEXT_PUBLIC_SOCKET_URL: 'http://game.example.com' }, /https/],
    ['no Supabase address', { NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL is not set/],
    ['no anon key', { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, /ANON_KEY is not set/],
  ])('FAILS the build with %s', (_label, change, message) => {
    expect(() => loadConfig({ ...GOOD, VERCEL: '1', ...change })).toThrow(/Refusing to build/);
    expect(() => loadConfig({ ...GOOD, VERCEL: '1', ...change })).toThrow(message);
  });
});

describe('on a laptop (no VERCEL)', () => {
  it('a half-filled environment only warns, so npm run dev still starts', () => {
    expect(() => loadConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: GOOD.NEXT_PUBLIC_SUPABASE_ANON_KEY })).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('a complete environment prints nothing', () => {
    loadConfig(GOOD);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('CHECK_ENV_STRICT=true makes the same gap fatal (to rehearse a deploy locally)', () => {
    expect(() => loadConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: GOOD.NEXT_PUBLIC_SUPABASE_ANON_KEY, CHECK_ENV_STRICT: 'true' })).toThrow(/Refusing to build/);
  });
});

describe('a service role key in a public variable is fatal EVERYWHERE', () => {
  it('in the anon key variable, on a laptop', () => {
    expect(() => loadConfig({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow(/SERVICE ROLE/);
  });

  it('in any other NEXT_PUBLIC_ variable, on Vercel', () => {
    expect(() => loadConfig({ ...GOOD, VERCEL: '1', NEXT_PUBLIC_LEAK: jwt('service_role') })).toThrow(/NEXT_PUBLIC_LEAK/);
  });

  it('the thrown message does not contain the key', () => {
    const secret = jwt('service_role');
    try {
      loadConfig({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: secret });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
