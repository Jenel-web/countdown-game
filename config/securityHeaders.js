/**
 * HTTP security headers for the web app, built from the environment so the
 * Content-Security-Policy knows which Supabase project and game server the
 * browser is allowed to talk to. Used by next.config.js; kept as a plain
 * function so config/securityHeaders.test.ts can check it.
 *
 * What is ENFORCED now (low risk of breaking pages):
 *   - nobody can put the site in a frame (clickjacking): X-Frame-Options + CSP frame-ancestors
 *   - the browser may not guess content types (nosniff)
 *   - the referrer sent to other sites is trimmed to the origin
 *   - camera, microphone, location and similar browser features are switched off
 *   - HTTPS is pinned for two years (production only)
 *   - <base>, <object> and form targets are locked to this site
 *
 * What is REPORT-ONLY for now: the strict policy that limits where scripts,
 * styles, fonts, images and network requests may come from. Violations show in
 * the browser console (DevTools > Console) without blocking anything. After a
 * staging run with no violations on the pages you use, switch it to enforcing
 * by setting CSP_ENFORCE=true on the host (no code change needed).
 *
 * 'unsafe-inline' stays in script-src and style-src because Next.js and
 * framer-motion emit inline scripts and styles. A nonce-based policy would
 * remove that but needs per-request rendering; it is a later improvement.
 */

/** @param {string | undefined} raw @returns {URL | null} */
function parseUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** A URL's origin plus its websocket twin, e.g. https://x.co -> [https://x.co, wss://x.co]. */
function withWebsocketTwin(url) {
  if (!url) return [];
  const ws = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : null;
  return ws ? [url.origin, `${ws}//${url.host}`] : [url.origin];
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ key: string, value: string }[]}
 */
function buildSecurityHeaders(env) {
  const isProduction = env.NODE_ENV === 'production';
  const enforceCsp = env.CSP_ENFORCE === 'true';

  const supabase = parseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const socket = parseUrl(env.NEXT_PUBLIC_SOCKET_URL) ?? (isProduction ? null : parseUrl('http://localhost:4000'));

  const connectSrc = ["'self'", ...withWebsocketTwin(supabase), ...withWebsocketTwin(socket)];

  const scriptSrc = ["'self'", "'unsafe-inline'"];
  // Next's dev server uses eval for hot reload. Never allowed in production.
  if (!isProduction) scriptSrc.push("'unsafe-eval'");

  const strictPolicy = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // No 'upgrade-insecure-requests': Strict-Transport-Security already pins
    // https on a real site, and enforcing it would break a local production
    // preview, where the game server is plain http://localhost:4000.
  ].join('; ');

  // Always enforced: the part that cannot break a normal page.
  const alwaysEnforced = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join('; ');

  /** @type {{ key: string, value: string }[]} */
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },
    enforceCsp
      ? { key: 'Content-Security-Policy', value: strictPolicy }
      : { key: 'Content-Security-Policy', value: alwaysEnforced },
  ];

  if (!enforceCsp) headers.push({ key: 'Content-Security-Policy-Report-Only', value: strictPolicy });

  if (isProduction) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
  }

  return headers;
}

module.exports = { buildSecurityHeaders };
