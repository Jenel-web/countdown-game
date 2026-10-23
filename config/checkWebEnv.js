/**
 * Checks the web app's environment variables so a bad deploy fails loudly at
 * BUILD time instead of shipping a site that quietly cannot log anyone in or
 * connect to the game server. Used by next.config.js; kept as a plain function
 * so config/checkWebEnv.test.ts can check it.
 *
 * Returns { errors, warnings }. next.config.js throws on errors when building
 * on Vercel (or with CHECK_ENV_STRICT=true) and only prints them elsewhere,
 * EXCEPT the service-role-key check, which is always fatal: that key must never
 * reach the browser (CLAUDE.md section 8).
 */

/** @param {string | undefined} raw */
function parseUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** True for a Supabase key that bypasses Row Level Security. */
function isPrivilegedSupabaseKey(key) {
  const k = (key || '').trim();
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[], fatalAlways: string[] }}
 */
function checkWebEnv(env) {
  const errors = [];
  const warnings = [];
  const fatalAlways = [];

  // Supabase URL: required, https.
  const supabaseUrl = parseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is not set. Login and every database call will fail.');
  } else if (!supabaseUrl) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  } else if (supabaseUrl.protocol !== 'https:') {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must start with https:// (Supabase projects are https only).');
  }

  // Supabase key: required, and never a privileged one.
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey || !anonKey.trim()) {
    errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Login and every database call will fail.');
  } else if (isPrivilegedSupabaseKey(anonKey)) {
    fatalAlways.push(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY holds a SERVICE ROLE / secret key. NEXT_PUBLIC_ values are sent to every ' +
        'visitor and that key bypasses all database security. Replace it with the anon / publishable key and ' +
        'rotate the leaked key in the Supabase dashboard.'
    );
  }

  // Any other NEXT_PUBLIC_ variable that looks like the service role key.
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('NEXT_PUBLIC_') && name !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY' && isPrivilegedSupabaseKey(value)) {
      fatalAlways.push(`${name} holds a service role / secret key. NEXT_PUBLIC_ values are sent to every visitor.`);
    }
  }
  if (Object.keys(env).some((n) => /^NEXT_PUBLIC_.*SERVICE_ROLE/i.test(n))) {
    fatalAlways.push('A NEXT_PUBLIC_*SERVICE_ROLE* variable exists. The service role key must never be public.');
  }

  // Game server URL: required for multiplayer, https on a deployed site.
  const socketUrl = parseUrl(env.NEXT_PUBLIC_SOCKET_URL);
  const onVercel = Boolean(env.VERCEL);
  if (!env.NEXT_PUBLIC_SOCKET_URL) {
    errors.push(
      'NEXT_PUBLIC_SOCKET_URL is not set. The site would try http://localhost:4000 and multiplayer would never connect.'
    );
  } else if (!socketUrl) {
    errors.push('NEXT_PUBLIC_SOCKET_URL is not a valid URL.');
  } else if (onVercel && socketUrl.protocol !== 'https:') {
    errors.push(
      'NEXT_PUBLIC_SOCKET_URL must be https:// on a deployed site: browsers block an http:// game server from an https:// page.'
    );
  } else if (onVercel && ['localhost', '127.0.0.1', '[::1]'].includes(socketUrl.hostname)) {
    errors.push('NEXT_PUBLIC_SOCKET_URL points at localhost, which is the visitor\'s own machine on a deployed site.');
  }

  return { errors, warnings, fatalAlways };
}

module.exports = { checkWebEnv, isPrivilegedSupabaseKey };
