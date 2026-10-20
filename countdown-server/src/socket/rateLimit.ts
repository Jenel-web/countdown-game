/**
 * =============================================================================
 * FILE: src/socket/rateLimit.ts
 * RESPONSIBILITY: Keep one misbehaving client from taking the server (or the
 * database behind it) down. Four independent layers, cheapest first:
 *
 *   1. MAX_PAYLOAD_BYTES      a hard cap on one packet's size (Socket.io option)
 *   2. IP connection limiter  runs BEFORE authMiddleware, so a flood of
 *                             connection attempts never reaches Supabase's
 *                             auth API
 *   3. per-account cap        one account can only hold a few open sockets
 *   4. per-socket packet      a token bucket for all events plus tighter ones
 *      limiter                for the events that cost a database round-trip;
 *                             a socket that keeps ignoring the limits is
 *                             disconnected
 *
 * Everything is in-memory and dependency-free. That matches the rest of the
 * server (live state already lives in one process) and means these limits are
 * per server instance.
 * =============================================================================
 */

import type { Server, Socket } from 'socket.io';

/** Largest single packet Socket.io will accept. Real payloads are well under 1KB. */
export const MAX_PAYLOAD_BYTES = 10_000;

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

export interface TokenBucket {
  /** Takes one token if available. False means "over the limit". */
  tryTake(): boolean;
  /** True when the bucket is completely full again (safe to forget). */
  readonly idle: boolean;
}

/**
 * Classic token bucket: holds up to `capacity` tokens, gains `refillPerSec`
 * tokens per second. A burst of up to `capacity` is allowed; sustained traffic
 * is held to `refillPerSec`.
 */
export function createTokenBucket(
  capacity: number,
  refillPerSec: number,
  now: () => number = Date.now
): TokenBucket {
  let tokens = capacity;
  let last = now();

  function refill() {
    const t = now();
    const elapsedSec = (t - last) / 1000;
    if (elapsedSec > 0) {
      tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec);
      last = t;
    }
  }

  return {
    tryTake() {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
    get idle() {
      refill();
      return tokens >= capacity;
    },
  };
}

export interface Limit {
  capacity: number;
  refillPerSec: number;
}

// ---------------------------------------------------------------------------
// Layer 2: connection attempts per IP (runs before auth)
// ---------------------------------------------------------------------------

/** 30 connection attempts in a burst, then 1 every 2 seconds. Generous for a household or office NAT. */
export const DEFAULT_IP_LIMIT: Limit = { capacity: 30, refillPerSec: 0.5 };

type AnySocket = Socket<any, any, any, any>;
type Middleware = (socket: AnySocket, next: (err?: Error) => void) => void;

/**
 * The address the connection should be rate-limited under.
 *
 * Behind a reverse proxy (Render, Railway, Fly) every socket's TCP address is
 * the proxy's, which would put all players in ONE bucket. With `trustProxy`
 * we use the LAST X-Forwarded-For entry - the one the proxy itself appended.
 * (The first entries are whatever the client claimed and can be forged.)
 * Only enable it when the server really is behind exactly one such proxy.
 */
export function clientIp(socket: AnySocket, trustProxy: boolean): string {
  if (trustProxy) {
    const header = socket.handshake.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (raw) {
      const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  return socket.handshake.address;
}

export function createIpRateLimiter(options: {
  limit?: Limit;
  trustProxy?: boolean;
  now?: () => number;
} = {}) {
  const { capacity, refillPerSec } = options.limit ?? DEFAULT_IP_LIMIT;
  const buckets = new Map<string, TokenBucket>();

  // Forget addresses that have been quiet long enough to be back at full
  // capacity, so the map can't grow forever.
  const sweeper = setInterval(() => {
    for (const [ip, bucket] of buckets) if (bucket.idle) buckets.delete(ip);
  }, 60_000);
  sweeper.unref();

  const middleware: Middleware = (socket, next) => {
    const ip = clientIp(socket, options.trustProxy === true);
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = createTokenBucket(capacity, refillPerSec, options.now);
      buckets.set(ip, bucket);
    }
    if (!bucket.tryTake()) {
      console.warn(`[rate-limit] too many connection attempts from ${ip}`);
      return next(new Error('Too many connection attempts. Please wait a moment and try again.'));
    }
    next();
  };

  return { middleware, size: () => buckets.size, stop: () => clearInterval(sweeper) };
}

// ---------------------------------------------------------------------------
// Layer 3: open sockets per account (runs after auth)
// ---------------------------------------------------------------------------

/** A player legitimately has 1 socket, briefly 2-3 while a refresh/reconnect overlaps. */
export const DEFAULT_MAX_SOCKETS_PER_USER = 5;

export function createUserConnectionCap(
  io: Server<any, any, any, any>,
  max: number = DEFAULT_MAX_SOCKETS_PER_USER
): Middleware {
  return (socket, next) => {
    let open = 0;
    for (const other of io.sockets.sockets.values()) {
      if (other.id !== socket.id && other.data.userId === socket.data.userId) open++;
    }
    if (open >= max) {
      console.warn(`[rate-limit] user ${socket.data.userId} already has ${open} open connections`);
      return next(new Error('Too many open connections for this account.'));
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Layer 4: packets per socket
// ---------------------------------------------------------------------------

export interface PacketLimits {
  /** Budget for every packet on the socket, whatever its event name. */
  all: Limit;
  /** Extra, tighter budgets for events that cost a DB round-trip or real work. */
  perEvent: Record<string, Limit>;
  /** A socket that has had this many packets dropped is disconnected. */
  maxDropped: number;
}

export const DEFAULT_PACKET_LIMITS: PacketLimits = {
  all: { capacity: 40, refillPerSec: 20 },
  perEvent: {
    join_room: { capacity: 5, refillPerSec: 0.5 }, // DB read (+write)
    cancel_room: { capacity: 5, refillPerSec: 0.5 }, // DB delete/update
    submit_answer: { capacity: 8, refillPerSec: 1 }, // engine replay; one counts per round
    player_status: { capacity: 20, refillPerSec: 10 }, // cosmetic, fires per tile click
    request_rematch: { capacity: 3, refillPerSec: 0.1 },
    rematch_response: { capacity: 3, refillPerSec: 0.1 }, // DB insert
  },
  maxDropped: 100,
};

/**
 * Per-socket packet middleware for `socket.use(...)`. Over-limit packets are
 * silently dropped (no reply: answering a flood is itself work). A socket that
 * keeps going past `maxDropped` is disconnected - mid-match that means the
 * normal reconnect grace period, then forfeit.
 */
export function createPacketLimiter(
  socket: Pick<AnySocket, 'id' | 'disconnect'>,
  limits: PacketLimits = DEFAULT_PACKET_LIMITS,
  now?: () => number
) {
  const all = createTokenBucket(limits.all.capacity, limits.all.refillPerSec, now);
  // A Map, not an object: an event named "__proto__" or "constructor" must not hit Object.prototype.
  const perEvent = new Map<string, TokenBucket>();
  for (const [event, l] of Object.entries(limits.perEvent)) {
    perEvent.set(event, createTokenBucket(l.capacity, l.refillPerSec, now));
  }
  let dropped = 0;

  return (packet: unknown[], next: (err?: Error) => void): void => {
    const event = String(packet[0]);
    const specific = perEvent.get(event);
    // Evaluate both so a flood of one event also burns the overall budget.
    const okAll = all.tryTake();
    const okEvent = specific ? specific.tryTake() : true;
    if (okAll && okEvent) return next();

    dropped++;
    if (dropped === limits.maxDropped) {
      console.warn(`[rate-limit] disconnecting socket ${socket.id}: ${dropped} packets over the limit`);
      socket.disconnect(true);
    }
  };
}
