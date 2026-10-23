/**
 * =============================================================================
 * FILE: src/config.ts
 * RESPONSIBILITY: Read and check the server's settings once, at start-up, so a
 * bad deploy stops with a clear message instead of running half-broken:
 *   - ALLOWED_ORIGIN unset on the host used to fall back to http://localhost:3000,
 *     so every real player's browser was refused with no explanation;
 *   - TRUST_PROXY unset behind Render/Railway/Fly puts every player in ONE
 *     connection-rate bucket, so a handful of users could lock out everyone.
 *
 * Pure function over an env object, so it is unit tested. index.ts calls it.
 * (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are checked by supabase/adminClient.ts.)
 * =============================================================================
 */

export interface ServerConfig {
  port: number;
  /** Browser origins allowed to open a socket, e.g. https://countdown.vercel.app */
  allowedOrigins: string[];
  /** True only when behind exactly one reverse proxy (see rateLimit.clientIp). */
  trustProxy: boolean;
  isProduction: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid server configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

export const DEV_ORIGIN = 'http://localhost:3000';

type Env = Readonly<Record<string, string | undefined>>;

/** NODE_ENV=production, or one of the hosts we deploy to says so. Render does not always set NODE_ENV. */
export function isProductionEnv(env: Env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.RENDER) || Boolean(env.RAILWAY_ENVIRONMENT) || Boolean(env.FLY_APP_NAME);
}

/** Returns the normalised origin, or null if `raw` is not a plain http(s) origin. */
function parseOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
  return url.origin;
}

/**
 * @throws ConfigError for anything that must stop start-up.
 * @returns the config plus warnings the caller should print.
 */
export function loadServerConfig(env: Env): { config: ServerConfig; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const isProduction = isProductionEnv(env);

  // PORT
  let port = 4000;
  if (env.PORT !== undefined && env.PORT.trim() !== '') {
    // Digits only: Number() would also accept "4e3" (4000) and "0x10" (16).
    const trimmed = env.PORT.trim();
    const n = /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 65535) problems.push(`PORT must be a whole number from 1 to 65535, got "${env.PORT}".`);
    else port = n;
  }

  // ALLOWED_ORIGIN (comma separated for several sites, e.g. apex and www)
  const rawOrigins = (env.ALLOWED_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  let allowedOrigins: string[] = [];
  if (rawOrigins.length === 0) {
    if (isProduction) {
      problems.push(
        'ALLOWED_ORIGIN is not set. Set it to your website address, e.g. https://your-site.vercel.app. ' +
          'Without it every real browser would be refused.'
      );
    } else {
      allowedOrigins = [DEV_ORIGIN];
    }
  } else {
    for (const raw of rawOrigins) {
      if (raw === '*') {
        problems.push('ALLOWED_ORIGIN must not be "*". List the exact site address(es).');
        continue;
      }
      const origin = parseOrigin(raw);
      if (!origin) {
        problems.push(`ALLOWED_ORIGIN entry "${raw}" is not a plain origin like https://example.com (no path, query or login).`);
        continue;
      }
      if (isProduction && new URL(origin).protocol !== 'https:' && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
        warnings.push(`ALLOWED_ORIGIN entry ${origin} is not https. Browsers on an https site will not be able to connect from it.`);
      }
      if (isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
        warnings.push(`ALLOWED_ORIGIN contains ${origin} in production. That only lets people connect from their own machine.`);
      }
      allowedOrigins.push(origin);
    }
  }

  // TRUST_PROXY
  let trustProxy = false;
  const rawProxy = env.TRUST_PROXY?.trim().toLowerCase();
  if (rawProxy === 'true') trustProxy = true;
  else if (rawProxy === 'false') trustProxy = false;
  else if (rawProxy !== undefined && rawProxy !== '') {
    warnings.push(`TRUST_PROXY must be "true" or "false", got "${env.TRUST_PROXY}". Treating it as false.`);
  } else if (isProduction) {
    warnings.push(
      'TRUST_PROXY is not set. Behind Render, Railway or Fly every player then appears to come from the proxy, ' +
        'shares ONE connection-rate limit, and a few users can lock everyone out. Set TRUST_PROXY=true when the ' +
        'server sits behind exactly one reverse proxy; set it to false only when players connect directly.'
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return { config: { port, allowedOrigins, trustProxy, isProduction }, warnings };
}
