import { describe, it, expect } from 'vitest';
import { buildSecurityHeaders } from './securityHeaders';

const SUPABASE = 'https://abcd1234.supabase.co';
const SOCKET = 'https://game.onrender.com';

type Header = { key: string; value: string };
const header = (headers: Header[], key: string) => headers.find((h) => h.key === key)?.value;
const prod = (extra: Record<string, string | undefined> = {}) =>
  buildSecurityHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SOCKET_URL: SOCKET, ...extra });

describe('always-on headers', () => {
  const h = prod();

  it('blocks framing (clickjacking), two ways', () => {
    expect(header(h, 'X-Frame-Options')).toBe('DENY');
    expect(header(h, 'Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('turns off content sniffing, trims the referrer and disables powerful browser features', () => {
    expect(header(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(h, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    const perms = header(h, 'Permissions-Policy')!;
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) expect(perms).toContain(feature);
  });

  it('locks <base>, <object> and form targets to this site', () => {
    const csp = header(h, 'Content-Security-Policy')!;
    for (const d of ["base-uri 'self'", "object-src 'none'", "form-action 'self'"]) expect(csp).toContain(d);
  });

  it('every header has a non-empty key and value', () => {
    for (const x of h) {
      expect(x.key.length).toBeGreaterThan(0);
      expect(x.value.length).toBeGreaterThan(0);
    }
  });
});

describe('HTTPS pinning', () => {
  it('is on in production', () => {
    expect(header(prod(), 'Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
  });
  it('is off in development (it would stick to localhost in the browser)', () => {
    expect(header(buildSecurityHeaders({ NODE_ENV: 'development' }), 'Strict-Transport-Security')).toBeUndefined();
  });
});

describe('strict policy rollout', () => {
  it('is REPORT-ONLY by default: nothing can be blocked by it yet', () => {
    const h = prod();
    expect(header(h, 'Content-Security-Policy-Report-Only')).toBeDefined();
    expect(header(h, 'Content-Security-Policy')).not.toContain('script-src');
  });

  it('CSP_ENFORCE=true enforces it and drops the report-only copy', () => {
    const h = prod({ CSP_ENFORCE: 'true' });
    expect(header(h, 'Content-Security-Policy')).toContain('script-src');
    expect(header(h, 'Content-Security-Policy-Report-Only')).toBeUndefined();
    // framing stays blocked through X-Frame-Options
    expect(header(h, 'X-Frame-Options')).toBe('DENY');
  });

  it('any value other than exactly "true" keeps it report-only', () => {
    for (const v of ['1', 'TRUE', 'yes', '', undefined]) {
      expect(header(prod({ CSP_ENFORCE: v }), 'Content-Security-Policy-Report-Only')).toBeDefined();
    }
  });
});

describe('strict policy contents', () => {
  const policy = header(prod(), 'Content-Security-Policy-Report-Only')!;
  const directive = (name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('lets the browser reach exactly this Supabase project (https and websocket) and this game server', () => {
    const connect = directive('connect-src');
    expect(connect).toContain("'self'");
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain('wss://abcd1234.supabase.co');
    expect(connect).toContain(SOCKET);
    expect(connect).toContain('wss://game.onrender.com');
  });

  it('does not allow arbitrary hosts to connect', () => {
    expect(directive('connect-src')).not.toContain('*');
    expect(directive('connect-src').split(' ')).not.toContain('https:');
  });

  it('allows only Google Fonts as outside style and font sources', () => {
    expect(directive('style-src')).toContain('https://fonts.googleapis.com');
    expect(directive('font-src')).toContain('https://fonts.gstatic.com');
  });

  it('never allows eval in production, and bans frames and plugins', () => {
    expect(directive('script-src')).not.toContain('unsafe-eval');
    expect(directive('frame-src')).toContain("'none'");
    expect(directive('object-src')).toContain("'none'");
  });

  it('does not use upgrade-insecure-requests (HSTS covers it, and it would break a local http preview)', () => {
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(header(prod({ CSP_ENFORCE: 'true' }), 'Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
  });

  it('development allows eval (hot reload) and the local game server', () => {
    const dev = header(buildSecurityHeaders({ NODE_ENV: 'development' }), 'Content-Security-Policy-Report-Only')!;
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('http://localhost:4000');
    expect(dev).toContain('ws://localhost:4000');
  });

  it('survives missing or garbage URLs without throwing, and without opening connect-src', () => {
    for (const env of [{}, { NEXT_PUBLIC_SUPABASE_URL: 'not a url', NEXT_PUBLIC_SOCKET_URL: '::::' }]) {
      const h = buildSecurityHeaders({ NODE_ENV: 'production', ...env });
      const connect = header(h, 'Content-Security-Policy-Report-Only')!.split('; ').find((d) => d.startsWith('connect-src'))!;
      expect(connect).toBe("connect-src 'self'");
    }
  });

  it('a path on the configured URL does not widen or break the policy', () => {
    const p = header(prod({ NEXT_PUBLIC_SOCKET_URL: 'https://game.onrender.com/some/path?x=1' }), 'Content-Security-Policy-Report-Only')!;
    expect(p).toContain('https://game.onrender.com');
    expect(p).not.toContain('/some/path');
  });
});
