import { describe, it, expect } from 'vitest';
import { checkWebEnv, isPrivilegedSupabaseKey } from './checkWebEnv';

function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ role, iss: 'supabase' })}.sig`;
}

const good: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  NEXT_PUBLIC_SOCKET_URL: 'https://game.onrender.com',
  VERCEL: '1',
};

describe('isPrivilegedSupabaseKey', () => {
  it('flags a service_role JWT and a new-style secret key', () => {
    expect(isPrivilegedSupabaseKey(jwt('service_role'))).toBe(true);
    expect(isPrivilegedSupabaseKey('sb_secret_abc123')).toBe(true);
  });
  it('does not flag the public keys', () => {
    expect(isPrivilegedSupabaseKey(jwt('anon'))).toBe(false);
    expect(isPrivilegedSupabaseKey('sb_publishable_abc123')).toBe(false);
  });
  it('copes with junk', () => {
    for (const junk of [undefined, '', 'a.b.c', 'x.y', '  ']) expect(isPrivilegedSupabaseKey(junk as string)).toBe(false);
  });
});

describe('checkWebEnv: a correct deployment', () => {
  it('has no errors', () => {
    const r = checkWebEnv(good);
    expect(r.errors).toEqual([]);
    expect(r.fatalAlways).toEqual([]);
  });
});

describe('checkWebEnv: missing or wrong values', () => {
  it.each([
    ['no Supabase URL', { NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL is not set/],
    ['Supabase URL not a URL', { NEXT_PUBLIC_SUPABASE_URL: 'abcd.supabase.co' }, /not a valid URL/],
    ['Supabase URL over http', { NEXT_PUBLIC_SUPABASE_URL: 'http://abcd.supabase.co' }, /https/],
    ['no anon key', { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, /ANON_KEY is not set/],
    ['blank anon key', { NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ' }, /ANON_KEY is not set/],
    ['no socket URL', { NEXT_PUBLIC_SOCKET_URL: undefined }, /SOCKET_URL is not set/],
    ['socket URL not a URL', { NEXT_PUBLIC_SOCKET_URL: 'game server' }, /not a valid URL/],
    ['socket URL over http on Vercel', { NEXT_PUBLIC_SOCKET_URL: 'http://game.example.com' }, /https/],
    ['socket URL is localhost on Vercel', { NEXT_PUBLIC_SOCKET_URL: 'https://localhost:4000' }, /localhost/],
  ])('%s', (_label, change, message) => {
    const r = checkWebEnv({ ...good, ...change });
    expect(r.errors.some((e) => message.test(e))).toBe(true);
  });

  it('http://localhost is fine off Vercel (local development and a local production build)', () => {
    const local = { ...good, NEXT_PUBLIC_SOCKET_URL: 'http://localhost:4000', VERCEL: undefined };
    expect(checkWebEnv(local).errors).toEqual([]);
  });

  it('reports every problem at once, not just the first', () => {
    expect(checkWebEnv({ VERCEL: '1' }).errors.length).toBe(3);
  });
});

describe('checkWebEnv: the service role key must never be public', () => {
  it('a service_role JWT in the anon key variable is always fatal', () => {
    const r = checkWebEnv({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(r.fatalAlways.join(' ')).toMatch(/SERVICE ROLE/);
  });

  it('a new-style secret key in the anon key variable is fatal', () => {
    expect(checkWebEnv({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abc' }).fatalAlways.length).toBeGreaterThan(0);
  });

  it('a service role key in ANY other NEXT_PUBLIC_ variable is fatal', () => {
    const r = checkWebEnv({ ...good, NEXT_PUBLIC_SOMETHING: jwt('service_role') });
    expect(r.fatalAlways.join(' ')).toMatch(/NEXT_PUBLIC_SOMETHING/);
  });

  it('a NEXT_PUBLIC_*SERVICE_ROLE* variable name is fatal even with a harmless value', () => {
    const r = checkWebEnv({ ...good, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' });
    expect(r.fatalAlways.length).toBeGreaterThan(0);
  });

  it('the (server-only) SUPABASE_SERVICE_ROLE_KEY name alone is NOT flagged: it is not public', () => {
    expect(checkWebEnv({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }).fatalAlways).toEqual([]);
  });

  it('never repeats the key itself in a message', () => {
    const secret = jwt('service_role');
    const r = checkWebEnv({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: secret });
    expect([...r.errors, ...r.fatalAlways].join(' ')).not.toContain(secret);
  });
});
