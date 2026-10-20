/**
 * =============================================================================
 * FILE: scripts/lib/localTarget.ts
 * RESPONSIBILITY: The ONE place the simulation scripts turn a URL into network
 * traffic. The scripts deliberately misbehave (floods, forged packets), so they
 * must never be pointed at anything but a server on this machine.
 *
 *   parseLocalTarget()   strict check: http(s), a loopback host, no
 *                        credentials, no path/query/fragment
 *   localFetch()         the only fetch() call the scripts make
 *   connectLocalSocket() the only io() call the scripts make
 *
 * Both network helpers re-validate the target themselves instead of trusting
 * their caller, so an exported function called directly (or a hand-built
 * object passed in place of a parsed target) still cannot reach another host.
 * =============================================================================
 */

import { io, type Socket } from 'socket.io-client';

/** URL.hostname values that mean "this machine". IPv6 hostnames keep their brackets. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

declare const localTargetBrand: unique symbol;

/** A server address that has passed parseLocalTarget(). Only that function creates one. */
export interface LocalTarget {
  /** Normalised scheme://host[:port], e.g. "http://localhost:4000". */
  readonly origin: string;
  readonly [localTargetBrand]: true;
}

function refuse(reason: string): never {
  throw new Error(`Refusing to run: ${reason}. These scripts only attack a server on your own machine.`);
}

/** Validates `raw` and returns it as a LocalTarget, or throws an error starting with "Refusing". */
export function parseLocalTarget(raw: unknown): LocalTarget {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) refuse('the server address is missing or malformed');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    refuse(`"${raw.slice(0, 80)}" is not a valid URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') refuse(`scheme "${url.protocol}" is not http or https`);
  // "http://localhost@evil.com" parses as host evil.com, but reject credentials outright anyway:
  // there is no legitimate reason for them and they make the address hard to read at a glance.
  if (url.username || url.password) refuse('the address contains a username or password');
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse(`"${url.hostname}" is not localhost`);
  if (url.pathname !== '/' || url.search || url.hash) refuse('the address must be just scheme://host:port');

  return Object.freeze({ origin: url.origin }) as LocalTarget;
}

/**
 * Accepts a raw string or an already-parsed target and validates it either way.
 * Re-parsing `target.origin` is what makes a forged `{ origin: 'http://evil' }` useless.
 */
export function toLocalTarget(target: string | LocalTarget): LocalTarget {
  return parseLocalTarget(typeof target === 'string' ? target : (target as { origin?: unknown })?.origin);
}

/** Kept for existing callers: throws unless `url` is a local server address. */
export function assertLocalhost(url: string): void {
  parseLocalTarget(url);
}

/** Paths the scripts are allowed to fetch. A fixed list, so no caller can steer the request. */
export type LocalPath = '/health';

/**
 * The only fetch() in the scripts. Re-validates the target, builds the URL from
 * a fixed path, checks the result is still on the same origin, and refuses
 * redirects (a redirect is how a "local" request could be bounced elsewhere).
 */
export async function localFetch(target: string | LocalTarget, path: LocalPath, timeoutMs = 3000): Promise<Response> {
  const { origin } = toLocalTarget(target);
  const url = new URL(path, origin);
  if (url.origin !== origin) refuse('the request URL left the target origin');
  return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * The only io() in the scripts. Re-validates the target, then opens a single
 * websocket connection that never auto-reconnects (so a refused or dropped
 * connection stays visible to the script instead of being retried silently).
 */
export function connectLocalSocket(target: string | LocalTarget, token: string): Socket {
  const { origin } = toLocalTarget(target);
  return io(origin, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
}
