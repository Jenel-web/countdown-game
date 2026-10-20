/**
 * Unit tests for src/socket/rateLimit.ts, using a fake clock so refill timing
 * is exact and the tests never sleep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
    clientIp,
    createIpRateLimiter,
    createPacketLimiter,
    createTokenBucket,
    createUserConnectionCap,
    DEFAULT_PACKET_LIMITS,
    type PacketLimits,
} from '../../src/socket/rateLimit';

afterEach(() => {
    vi.restoreAllMocks();
});

function fakeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createTokenBucket', () => {
    it('allows a burst up to capacity, then refuses', () => {
        const clock = fakeClock();
        const b = createTokenBucket(3, 1, clock.now);
        expect([b.tryTake(), b.tryTake(), b.tryTake(), b.tryTake()]).toEqual([true, true, true, false]);
    });

    it('refills at the configured rate', () => {
        const clock = fakeClock();
        const b = createTokenBucket(2, 1, clock.now); // 1 token / second
        b.tryTake();
        b.tryTake();
        expect(b.tryTake()).toBe(false);

        clock.advance(999);
        expect(b.tryTake()).toBe(false); // 0.999 tokens: not yet
        clock.advance(1);
        expect(b.tryTake()).toBe(true); // exactly 1 token
        expect(b.tryTake()).toBe(false);
    });

    it('never holds more than capacity, however long it sits idle', () => {
        const clock = fakeClock();
        const b = createTokenBucket(2, 10, clock.now);
        clock.advance(60 * 60 * 1000);
        expect([b.tryTake(), b.tryTake(), b.tryTake()]).toEqual([true, true, false]);
    });

    it('a clock that goes backwards neither crashes nor grants free tokens', () => {
        const clock = fakeClock();
        const b = createTokenBucket(1, 1, clock.now);
        expect(b.tryTake()).toBe(true);
        clock.advance(-5_000);
        expect(b.tryTake()).toBe(false);
    });

    it('reports idle only when completely full', () => {
        const clock = fakeClock();
        const b = createTokenBucket(2, 1, clock.now);
        expect(b.idle).toBe(true);
        b.tryTake();
        expect(b.idle).toBe(false);
        clock.advance(1000);
        expect(b.idle).toBe(true);
    });

    it('sustained over-rate traffic only gets the refill rate through', () => {
        const clock = fakeClock();
        const b = createTokenBucket(5, 2, clock.now); // 2 / s
        let allowed = 0;
        for (let i = 0; i < 1000; i++) {
            if (b.tryTake()) allowed++;
            clock.advance(10); // 100 attempts per second for 10 seconds
        }
        // capacity (5) + 10s * 2/s = 25, give or take rounding
        expect(allowed).toBeGreaterThanOrEqual(24);
        expect(allowed).toBeLessThanOrEqual(26);
    });
});

describe('createPacketLimiter', () => {
    const limits: PacketLimits = {
        all: { capacity: 10, refillPerSec: 0 },
        perEvent: { join_room: { capacity: 2, refillPerSec: 0 } },
        maxDropped: 5,
    };

    function setup(l: PacketLimits = limits) {
        const socket = { id: 'sock-1', disconnect: vi.fn() };
        const clock = fakeClock();
        const limiter = createPacketLimiter(socket, l, clock.now);
        const delivered: string[] = [];
        const send = (event: string) => limiter([event], () => delivered.push(event));
        return { socket, clock, delivered, send };
    }

    it('delivers packets while under budget', () => {
        const { delivered, send } = setup();
        send('submit_answer');
        send('player_status');
        expect(delivered).toEqual(['submit_answer', 'player_status']);
    });

    it('a per-event budget cuts off that event only', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { delivered, send } = setup();
        for (let i = 0; i < 4; i++) send('join_room');
        send('player_status');
        expect(delivered.filter((e) => e === 'join_room')).toHaveLength(2);
        expect(delivered).toContain('player_status');
    });

    it('the overall budget applies to every event name, including unknown ones', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { delivered, send } = setup();
        for (let i = 0; i < 50; i++) send(`made_up_${i}`);
        expect(delivered).toHaveLength(10);
    });

    it('dropped packets never reach the handler, and no reply is produced', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { delivered, send } = setup({ ...limits, maxDropped: 1000 });
        for (let i = 0; i < 20; i++) send('join_room');
        expect(delivered).toHaveLength(2);
    });

    it('disconnects the socket exactly once when it keeps flooding', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { socket, send } = setup();
        for (let i = 0; i < 40; i++) send('join_room'); // 2 delivered, 38 dropped, threshold is 5
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a well-behaved socket is never disconnected', () => {
        const { socket, clock, send } = setup({
            all: { capacity: 40, refillPerSec: 20 },
            perEvent: DEFAULT_PACKET_LIMITS.perEvent,
            maxDropped: 100,
        });
        // A busy but legitimate player: a tile click every 150ms, a submit now and then, for a minute.
        for (let i = 0; i < 400; i++) {
            send('player_status');
            if (i % 40 === 0) send('submit_answer');
            clock.advance(150);
        }
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('survives an event named like an Object.prototype member', () => {
        const { delivered, send } = setup();
        expect(() => {
            send('__proto__');
            send('constructor');
            send('toString');
            send('hasOwnProperty');
        }).not.toThrow();
        expect(delivered).toHaveLength(4);
    });

    it('survives odd first packet entries', () => {
        const { socket } = setup();
        const limiter = createPacketLimiter(socket, limits);
        const next = vi.fn();
        expect(() => limiter([undefined as unknown as string], next)).not.toThrow();
        expect(() => limiter([{}] as unknown[], next)).not.toThrow();
        expect(() => limiter([], next)).not.toThrow();
    });

    it('budgets recover over time (a pause lets the player act again)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { delivered, clock, send } = setup({
            all: { capacity: 10, refillPerSec: 10 },
            perEvent: { join_room: { capacity: 1, refillPerSec: 1 } },
            maxDropped: 1000,
        });
        send('join_room');
        send('join_room');
        expect(delivered).toHaveLength(1);
        clock.advance(1000);
        send('join_room');
        expect(delivered).toHaveLength(2);
    });
});

describe('clientIp', () => {
    const sock = (address: string, xff?: string | string[]) =>
        ({ handshake: { address, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } } }) as any;

    it('uses the TCP address when not behind a trusted proxy - and ignores a forged header', () => {
        expect(clientIp(sock('10.0.0.5', '1.2.3.4'), false)).toBe('10.0.0.5');
    });

    it('behind a trusted proxy, uses the LAST forwarded entry (the one the proxy added)', () => {
        expect(clientIp(sock('10.0.0.5', '6.6.6.6, 1.2.3.4'), true)).toBe('1.2.3.4');
    });

    it('a client cannot dodge the limit by forging the leading X-Forwarded-For entries', () => {
        const a = clientIp(sock('10.0.0.5', 'forged-1, 9.9.9.9'), true);
        const b = clientIp(sock('10.0.0.5', 'forged-2, 9.9.9.9'), true);
        expect(a).toBe(b);
    });

    it('handles array headers, blanks and a missing header', () => {
        expect(clientIp(sock('10.0.0.5', ['1.1.1.1', '2.2.2.2']), true)).toBe('2.2.2.2');
        expect(clientIp(sock('10.0.0.5', ' , '), true)).toBe('10.0.0.5');
        expect(clientIp(sock('10.0.0.5'), true)).toBe('10.0.0.5');
    });
});

describe('createIpRateLimiter', () => {
    const sock = (address: string) => ({ handshake: { address, headers: {} } }) as any;

    it('lets an address through until its bucket is empty, then rejects with a clear error', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const clock = fakeClock();
        const limiter = createIpRateLimiter({ limit: { capacity: 3, refillPerSec: 0 }, now: clock.now });
        const results: Array<Error | undefined> = [];
        for (let i = 0; i < 5; i++) limiter.middleware(sock('1.1.1.1'), (e) => results.push(e));
        limiter.stop();

        expect(results.slice(0, 3).every((e) => e === undefined)).toBe(true);
        expect(results[3]).toBeInstanceOf(Error);
        expect(results[3]!.message).toMatch(/too many connection attempts/i);
        expect(results[4]).toBeInstanceOf(Error);
    });

    it('addresses are limited independently', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const limiter = createIpRateLimiter({ limit: { capacity: 1, refillPerSec: 0 } });
        const a: Array<Error | undefined> = [];
        limiter.middleware(sock('1.1.1.1'), (e) => a.push(e));
        limiter.middleware(sock('1.1.1.1'), (e) => a.push(e));
        limiter.middleware(sock('2.2.2.2'), (e) => a.push(e));
        limiter.stop();
        expect(a.map((e) => e === undefined)).toEqual([true, false, true]);
    });

    it('recovers after the refill time', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const clock = fakeClock();
        const limiter = createIpRateLimiter({ limit: { capacity: 1, refillPerSec: 1 }, now: clock.now });
        const out: Array<Error | undefined> = [];
        limiter.middleware(sock('1.1.1.1'), (e) => out.push(e));
        limiter.middleware(sock('1.1.1.1'), (e) => out.push(e));
        clock.advance(1000);
        limiter.middleware(sock('1.1.1.1'), (e) => out.push(e));
        limiter.stop();
        expect(out.map((e) => e === undefined)).toEqual([true, false, true]);
    });

    it('thousands of distinct addresses are handled (and tracked)', () => {
        const limiter = createIpRateLimiter({ limit: { capacity: 1, refillPerSec: 0 } });
        for (let i = 0; i < 5000; i++) limiter.middleware(sock(`10.0.${i >> 8}.${i & 255}`), () => {});
        expect(limiter.size()).toBe(5000);
        limiter.stop();
    });
});

describe('createUserConnectionCap', () => {
    /** A handshaking socket: `conn` is the transport, the socket itself emits 'disconnect'. */
    function fakeSocket(userId: string, readyState = 'open') {
        const conn = Object.assign(new EventEmitter(), { readyState });
        const socket = Object.assign(new EventEmitter(), { id: `s-${Math.random()}`, data: { userId }, conn });
        return socket as any;
    }

    /** Runs the middleware; true = admitted. */
    function admit(cap: ReturnType<typeof createUserConnectionCap>, socket: any): boolean {
        let result: Error | undefined | 'unset' = 'unset';
        cap.middleware(socket, (err?: Error) => (result = err));
        return result === undefined;
    }

    it('admits up to the cap and refuses the next one with a clear error', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cap = createUserConnectionCap(3);
        const results = [1, 2, 3, 4].map(() => admit(cap, fakeSocket('a')));
        expect(results).toEqual([true, true, true, false]);

        const errors: Error[] = [];
        cap.middleware(fakeSocket('a'), (e?: Error) => e && errors.push(e));
        expect(errors[0].message).toMatch(/too many open connections/i);
    });

    it('is STRICT for concurrent handshakes: none have connected yet, but only `max` are admitted', () => {
        // The old cap counted connected sockets, so N handshakes in flight each saw 0 and all got in.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cap = createUserConnectionCap(5);
        const admitted = Array.from({ length: 60 }, () => admit(cap, fakeSocket('farm'))).filter(Boolean).length;
        expect(admitted).toBe(5);
        expect(cap.heldBy('farm')).toBe(5);
    });

    it('closing the transport frees the slot', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cap = createUserConnectionCap(1);
        const first = fakeSocket('a');
        expect(admit(cap, first)).toBe(true);
        expect(admit(cap, fakeSocket('a'))).toBe(false);

        first.conn.emit('close');
        expect(cap.heldBy('a')).toBe(0);
        expect(admit(cap, fakeSocket('a'))).toBe(true);
    });

    it('a namespace disconnect that leaves the transport open also frees the slot', () => {
        const cap = createUserConnectionCap(1);
        const s = fakeSocket('a');
        admit(cap, s);
        s.emit('disconnect');
        expect(cap.heldBy('a')).toBe(0);
    });

    it('releases exactly once when both disconnect AND close fire (no negative counts, no stolen slots)', () => {
        const cap = createUserConnectionCap(3);
        const a1 = fakeSocket('a');
        const a2 = fakeSocket('a');
        admit(cap, a1);
        admit(cap, a2);

        a1.emit('disconnect');
        a1.conn.emit('close');
        a1.conn.emit('close');
        expect(cap.heldBy('a')).toBe(1); // a2's slot untouched
    });

    it('a handshake abandoned during auth (transport already closed) is refused and reserves nothing', () => {
        const cap = createUserConnectionCap(1);
        expect(admit(cap, fakeSocket('a', 'closed'))).toBe(false);
        expect(admit(cap, fakeSocket('a', 'closing'))).toBe(false);
        expect(cap.heldBy('a')).toBe(0);
        expect(admit(cap, fakeSocket('a'))).toBe(true); // no slot was leaked
    });

    it('accounts are independent, and empty entries are forgotten (bounded memory)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cap = createUserConnectionCap(1);
        const b = fakeSocket('b');
        expect(admit(cap, fakeSocket('a'))).toBe(true);
        expect(admit(cap, b)).toBe(true);
        expect(admit(cap, fakeSocket('a'))).toBe(false);
        expect(cap.size()).toBe(2);

        b.conn.emit('close');
        expect(cap.size()).toBe(1);
    });

    it('churn: 1000 connect/close cycles leave nothing behind', () => {
        const cap = createUserConnectionCap(2);
        for (let i = 0; i < 1000; i++) {
            const s = fakeSocket(`u${i % 7}`);
            expect(admit(cap, s)).toBe(true);
            s.conn.emit('close');
        }
        expect(cap.size()).toBe(0);
    });
});
