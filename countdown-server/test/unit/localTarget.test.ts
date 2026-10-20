/**
 * Unit tests for scripts/lib/localTarget.ts - the guard that keeps the attack
 * and flood scripts pointed at this machine only. Most cases are tricks that
 * try to make a remote host look local.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import {
    assertLocalhost,
    connectLocalSocket,
    localFetch,
    parseLocalTarget,
    toLocalTarget,
    type LocalTarget,
} from '../../scripts/lib/localTarget';

describe('parseLocalTarget: accepted', () => {
    it.each([
        ['http://localhost:4000', 'http://localhost:4000'],
        ['http://localhost:4000/', 'http://localhost:4000'],
        ['http://127.0.0.1:4000', 'http://127.0.0.1:4000'],
        ['http://[::1]:4000', 'http://[::1]:4000'],
        ['https://localhost:8443', 'https://localhost:8443'],
        ['http://LOCALHOST:4000', 'http://localhost:4000'], // hostnames are case-insensitive
        ['http://localhost', 'http://localhost'],
        ['http://127.1:4000', 'http://127.0.0.1:4000'], // shorthand that the URL parser normalises to loopback
        ['http://0x7f.1:4000', 'http://127.0.0.1:4000'],
    ])('%s', (raw, origin) => {
        expect(parseLocalTarget(raw).origin).toBe(origin);
    });

    it('returns a frozen object', () => {
        expect(Object.isFrozen(parseLocalTarget('http://localhost:4000'))).toBe(true);
    });
});

describe('parseLocalTarget: refused', () => {
    it.each([
        // remote hosts
        ['http://example.com'],
        ['https://countdown-server.onrender.com'],
        ['http://10.0.0.5:4000'],
        ['http://192.168.1.10:4000'],
        ['http://127.0.0.2:4000'], // loopback range, but not the one address we allow
        ['http://0.0.0.0:4000'],
        // look-alikes
        ['http://localhost.evil.com'],
        ['http://evil-localhost'],
        ['http://localhost.:4000'], // trailing dot
        ['http://[::ffff:127.0.0.1]:4000'],
        // credentials tricks
        ['http://localhost@evil.com'], // the host here is evil.com
        ['http://evil.com@localhost:4000'], // host IS localhost, but credentials are refused outright
        ['http://user:pass@localhost:4000'],
        // other schemes
        ['ws://localhost:4000'],
        ['file:///etc/passwd'],
        ['ftp://localhost'],
        ['javascript:alert(1)'],
        // paths, queries, fragments (the scripts add their own fixed paths)
        ['http://localhost:4000/admin'],
        ['http://localhost:4000/?next=http://evil.com'],
        ['http://localhost:4000/#frag'],
        // not URLs at all
        [''],
        ['localhost:4000'],
        ['not a url'],
        ['http://' + 'a'.repeat(300)],
    ])('%s', (raw) => {
        expect(() => parseLocalTarget(raw)).toThrow(/^Refusing/);
    });

    it.each([[undefined], [null], [42], [{}], [['http://localhost:4000']]])('non-string %j', (raw) => {
        expect(() => parseLocalTarget(raw)).toThrow(/^Refusing/);
    });
});

describe('toLocalTarget / assertLocalhost', () => {
    it('re-validates an already-parsed target', () => {
        const t = parseLocalTarget('http://localhost:4000');
        expect(toLocalTarget(t)).toEqual(t);
    });

    it('a hand-built object pretending to be a parsed target is still refused', () => {
        const forged = { origin: 'http://evil.com' } as unknown as LocalTarget;
        expect(() => toLocalTarget(forged)).toThrow(/^Refusing/);
        expect(() => toLocalTarget({} as LocalTarget)).toThrow(/^Refusing/);
        expect(() => toLocalTarget(null as unknown as LocalTarget)).toThrow(/^Refusing/);
    });

    it('assertLocalhost keeps working for existing callers', () => {
        expect(() => assertLocalhost('http://localhost:4000')).not.toThrow();
        expect(() => assertLocalhost('http://example.com')).toThrow(/^Refusing/);
    });
});

describe('connectLocalSocket', () => {
    it('refuses a remote string before any connection is attempted', () => {
        expect(() => connectLocalSocket('http://example.com', 't')).toThrow(/^Refusing/);
    });

    it('refuses a forged target object (does not trust its caller)', () => {
        expect(() => connectLocalSocket({ origin: 'http://evil.com' } as unknown as LocalTarget, 't')).toThrow(/^Refusing/);
    });

    it('returns a socket that will not auto-reconnect', () => {
        const s = connectLocalSocket('http://127.0.0.1:1', 't'); // nothing listens on port 1
        expect(s.io.opts.reconnection).toBe(false);
        s.disconnect();
    });
});

describe('localFetch', () => {
    let server: Server;
    let origin: string;
    let hits: string[];

    beforeEach(async () => {
        hits = [];
        server = createServer((req, res) => {
            hits.push(req.url ?? '');
            if (req.url === '/health') {
                res.writeHead(200).end('ok');
            } else {
                res.writeHead(404).end();
            }
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        await new Promise<void>((r) => server.close(() => r()));
    });

    it('fetches the fixed path on the validated origin', async () => {
        const res = await localFetch(origin, '/health');
        expect(res.status).toBe(200);
        expect(hits).toEqual(['/health']);
    });

    it('refuses remote targets and forged objects without sending anything', async () => {
        await expect(localFetch('http://example.com', '/health')).rejects.toThrow(/^Refusing/);
        await expect(localFetch({ origin: 'http://evil.com' } as unknown as LocalTarget, '/health')).rejects.toThrow(/^Refusing/);
        expect(hits).toEqual([]);
    });

    it('a path that tries to escape the origin is refused', async () => {
        await expect(localFetch(origin, '//evil.com/health' as '/health')).rejects.toThrow(/^Refusing/);
        expect(hits).toEqual([]);
    });

    it('does NOT follow a redirect (a redirect is how a local request could be bounced to another host)', async () => {
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            hits.push(req.url ?? '');
            res.writeHead(302, { location: 'http://example.com/steal' }).end();
        });
        await expect(localFetch(origin, '/health')).rejects.toThrow();
        expect(hits).toEqual(['/health']); // one request to us, none followed
    });

    it('times out instead of hanging on a server that never answers', async () => {
        server.removeAllListeners('request');
        server.on('request', () => {
            /* never respond */
        });
        const t0 = Date.now();
        await expect(localFetch(origin, '/health', 200)).rejects.toThrow();
        expect(Date.now() - t0).toBeLessThan(2000);
    });
});
