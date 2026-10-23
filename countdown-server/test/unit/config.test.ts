/**
 * Unit tests for src/config.ts: the start-up checks that stop a bad deploy
 * from running half-broken.
 */
import { describe, it, expect } from 'vitest';
import { ConfigError, DEV_ORIGIN, isProductionEnv, loadServerConfig } from '../../src/config';

const prod = (extra: Record<string, string | undefined> = {}) => ({
    NODE_ENV: 'production',
    ALLOWED_ORIGIN: 'https://countdown.vercel.app',
    TRUST_PROXY: 'true',
    ...extra,
});

function problemsOf(env: Record<string, string | undefined>): string[] {
    try {
        loadServerConfig(env);
    } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        return (e as ConfigError).problems;
    }
    throw new Error('expected loadServerConfig to throw');
}

describe('isProductionEnv', () => {
    it('is true for NODE_ENV=production and for the hosts we deploy to, which do not always set it', () => {
        expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
        expect(isProductionEnv({ RENDER: 'true' })).toBe(true);
        expect(isProductionEnv({ RAILWAY_ENVIRONMENT: 'production' })).toBe(true);
        expect(isProductionEnv({ FLY_APP_NAME: 'countdown' })).toBe(true);
    });
    it('is false locally and in tests', () => {
        expect(isProductionEnv({})).toBe(false);
        expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false);
        expect(isProductionEnv({ NODE_ENV: 'test' })).toBe(false);
    });
});

describe('local development', () => {
    it('works with nothing set, using safe defaults', () => {
        const { config, warnings } = loadServerConfig({});
        expect(config).toEqual({ port: 4000, allowedOrigins: [DEV_ORIGIN], trustProxy: false, isProduction: false });
        expect(warnings).toEqual([]);
    });

    it('takes an explicit origin and port', () => {
        const { config } = loadServerConfig({ ALLOWED_ORIGIN: 'http://localhost:3001', PORT: '5000' });
        expect(config.allowedOrigins).toEqual(['http://localhost:3001']);
        expect(config.port).toBe(5000);
    });
});

describe('production: ALLOWED_ORIGIN', () => {
    it('is REQUIRED: the server refuses to start without it', () => {
        const problems = problemsOf({ NODE_ENV: 'production', TRUST_PROXY: 'true' });
        expect(problems.join(' ')).toMatch(/ALLOWED_ORIGIN is not set/);
    });

    it('blank or whitespace counts as missing', () => {
        for (const v of ['', '   ', ' , ']) {
            expect(problemsOf(prod({ ALLOWED_ORIGIN: v })).join(' ')).toMatch(/ALLOWED_ORIGIN is not set/);
        }
    });

    it('accepts a normal https site and strips a trailing slash', () => {
        expect(loadServerConfig(prod({ ALLOWED_ORIGIN: 'https://countdown.vercel.app/' })).config.allowedOrigins).toEqual([
            'https://countdown.vercel.app',
        ]);
    });

    it('accepts several sites, comma separated', () => {
        const { config } = loadServerConfig(prod({ ALLOWED_ORIGIN: 'https://a.com, https://www.a.com ,https://b.com' }));
        expect(config.allowedOrigins).toEqual(['https://a.com', 'https://www.a.com', 'https://b.com']);
    });

    it.each([
        ['wildcard', '*'],
        ['no scheme', 'countdown.vercel.app'],
        ['a path', 'https://countdown.vercel.app/lobby'],
        ['a query', 'https://countdown.vercel.app/?x=1'],
        ['a login in the address', 'https://user:pw@countdown.vercel.app'],
        ['another scheme', 'ftp://countdown.vercel.app'],
        ['a script scheme', 'javascript:alert(1)'],
    ])('rejects %s', (_label, value) => {
        expect(problemsOf(prod({ ALLOWED_ORIGIN: value })).length).toBeGreaterThan(0);
    });

    it('reports every bad entry, not only the first', () => {
        expect(problemsOf(prod({ ALLOWED_ORIGIN: '*, nonsense, https://ok.com/x' })).length).toBe(3);
    });

    it('warns (does not fail) when an entry is not https, or is localhost', () => {
        const http = loadServerConfig(prod({ ALLOWED_ORIGIN: 'http://countdown.example.com' }));
        expect(http.warnings.join(' ')).toMatch(/not https/);
        const local = loadServerConfig(prod({ ALLOWED_ORIGIN: 'http://localhost:3000' }));
        expect(local.warnings.join(' ')).toMatch(/localhost/);
    });
});

describe('TRUST_PROXY', () => {
    it('true and false are read case-insensitively', () => {
        expect(loadServerConfig(prod({ TRUST_PROXY: 'TRUE' })).config.trustProxy).toBe(true);
        expect(loadServerConfig(prod({ TRUST_PROXY: ' false ' })).config.trustProxy).toBe(false);
    });

    it('unset in production warns loudly about everyone sharing one limit', () => {
        const { config, warnings } = loadServerConfig(prod({ TRUST_PROXY: undefined }));
        expect(config.trustProxy).toBe(false);
        expect(warnings.join(' ')).toMatch(/TRUST_PROXY is not set[\s\S]*lock everyone out/);
    });

    it('an explicit true or false in production gives no warning', () => {
        expect(loadServerConfig(prod({ TRUST_PROXY: 'true' })).warnings).toEqual([]);
        expect(loadServerConfig(prod({ TRUST_PROXY: 'false' })).warnings).toEqual([]);
    });

    it('a mistyped value is treated as false, with a warning (never as true)', () => {
        for (const v of ['1', 'yes', 'on', 'ture']) {
            const { config, warnings } = loadServerConfig(prod({ TRUST_PROXY: v }));
            expect(config.trustProxy).toBe(false);
            expect(warnings.join(' ')).toMatch(/must be "true" or "false"/);
        }
    });

    it('unset locally is silent', () => {
        expect(loadServerConfig({}).warnings).toEqual([]);
    });
});

describe('PORT', () => {
    it.each(['0', '-1', '65536', '4000.5', 'abc', '4e3', '0x10'])('rejects %s', (v) => {
        expect(problemsOf({ PORT: v }).join(' ')).toMatch(/PORT must be/);
    });

    it('accepts the edges of the range, and blank means the default', () => {
        expect(loadServerConfig({ PORT: '1' }).config.port).toBe(1);
        expect(loadServerConfig({ PORT: '65535' }).config.port).toBe(65535);
        expect(loadServerConfig({ PORT: '' }).config.port).toBe(4000);
        expect(loadServerConfig({ PORT: '  ' }).config.port).toBe(4000);
    });
});

describe('error reporting', () => {
    it('lists every problem in one message', () => {
        try {
            loadServerConfig({ NODE_ENV: 'production', PORT: 'x' });
            throw new Error('should have thrown');
        } catch (e) {
            expect((e as ConfigError).problems.length).toBe(2);
            expect((e as Error).message).toMatch(/PORT[\s\S]*ALLOWED_ORIGIN/);
        }
    });

    it('never echoes a secret: the message only quotes the setting the person typed', () => {
        const problems = problemsOf({ PORT: 'not-a-port', SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value' });
        expect(problems.join(' ')).not.toContain('super-secret-value');
    });
});
