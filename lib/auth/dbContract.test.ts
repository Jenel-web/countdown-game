/**
 * Contract between the app code and the database lockdown SQL in docs/sql/.
 *
 * The database is the real guard, but it can only be tightened if the app never
 * asks for something the lockdown takes away. These tests fail when:
 *   - any `profiles` query in the app selects a column outside the public set
 *     that 2026-10-21-lockdown-c1.sql grants (most importantly `email`), or
 *     uses select('*') / select();
 *   - the reserved-username list in lib/auth/username.ts drifts from the one
 *     the database trigger enforces (and the audit query reports).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { RESERVED_USERNAMES } from './username';

const ROOT = resolve(__dirname, '../..');
const SQL = (name: string) => readFileSync(join(ROOT, 'docs/sql', name), 'utf8');

/** Columns a logged-in player may read from profiles (must match lockdown-c1's grant). */
const PUBLIC_PROFILE_COLUMNS = ['id', 'username', 'mmr', 'wins', 'losses', 'matches_played', 'created_at'];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'node_modules' || name.startsWith('.')) continue;
            out.push(...sourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

/** Every column list selected from `profiles` anywhere in the web app, with where it was found. */
function profileSelects(): { where: string; columns: string }[] {
    const files = [
        ...sourceFiles(join(ROOT, 'app')),
        ...sourceFiles(join(ROOT, 'lib')),
        ...sourceFiles(join(ROOT, 'components')),
        ...sourceFiles(join(ROOT, 'hooks')),
        ...sourceFiles(join(ROOT, 'context')),
        join(ROOT, 'middleware.ts'),
    ];
    const found: { where: string; columns: string }[] = [];
    const pattern = /\.from\(\s*['"]profiles['"]\s*\)([\s\S]{0,300}?)\.select\(\s*(?:(['"`])([\s\S]*?)\2)?\s*\)/g;
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(pattern)) {
            const line = text.slice(0, m.index).split('\n').length;
            found.push({ where: `${relative(ROOT, file)}:${line}`, columns: m[3] ?? '' });
        }
    }
    return found;
}

describe('profiles reads stay inside the public columns (lockdown-c1)', () => {
    it('the C1 grant lists exactly PUBLIC_PROFILE_COLUMNS', () => {
        const grant = /grant\s+select\s*\(([^)]*)\)\s*on\s+public\.profiles\s+to\s+authenticated/i.exec(
            SQL('2026-10-21-lockdown-c1.sql')
        );
        expect(grant, 'grant select (...) on public.profiles to authenticated not found').not.toBeNull();
        const granted = grant![1].split(',').map((c) => c.trim()).sort();
        expect(granted).toEqual([...PUBLIC_PROFILE_COLUMNS].sort());
    });

    it('finds the app\'s profiles queries (guards against the scan silently matching nothing)', () => {
        expect(profileSelects().length).toBeGreaterThanOrEqual(8);
    });

    it('no profiles query selects email, *, or any other non-public column', () => {
        const bad: string[] = [];
        for (const { where, columns } of profileSelects()) {
            const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
            if (cols.length === 0) bad.push(`${where}: select() with no column list (means *)`);
            for (const c of cols) {
                if (!PUBLIC_PROFILE_COLUMNS.includes(c)) bad.push(`${where}: selects "${c}"`);
            }
        }
        expect(bad).toEqual([]);
    });
});

describe('profiles writes stay inside what lockdown-c2 allows (username only, no inserts)', () => {
    /** Every write call chained onto .from('profiles') in the app: [method, argument text, where]. */
    function profileWrites(): { method: string; arg: string; where: string }[] {
        const files = [
            ...sourceFiles(join(ROOT, 'app')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'hooks')),
            ...sourceFiles(join(ROOT, 'context')),
            join(ROOT, 'middleware.ts'),
        ];
        const out: { method: string; arg: string; where: string }[] = [];
        const pattern = /\.from\(\s*['"]profiles['"]\s*\)\s*\.(insert|upsert|update|delete)\(([^)]*)\)/g;
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            for (const m of text.matchAll(pattern)) {
                const line = text.slice(0, m.index).split('\n').length;
                out.push({ method: m[1], arg: m[2], where: `${relative(ROOT, file)}:${line}` });
            }
        }
        return out;
    }

    it('the C2 grant lets players update only username', () => {
        const sql = SQL('2026-10-21-lockdown-c2.sql');
        const grant = /grant\s+update\s*\(([^)]*)\)\s*on\s+public\.profiles\s+to\s+authenticated/i.exec(sql);
        expect(grant).not.toBeNull();
        expect(grant![1].split(',').map((c) => c.trim())).toEqual(['username']);
        expect(sql).toMatch(/revoke\s+insert,\s*delete\s+on\s+public\.profiles\s+from\s+authenticated/i);
    });

    it('the app never inserts, upserts or deletes profiles rows', () => {
        const bad = profileWrites()
            .filter((w) => w.method !== 'update')
            .map((w) => `${w.where}: .${w.method}()`);
        expect(bad).toEqual([]);
    });

    it('every profiles update sets only username', () => {
        const updates = profileWrites().filter((w) => w.method === 'update');
        expect(updates.length).toBeGreaterThanOrEqual(1); // claimUsername
        const bad: string[] = [];
        for (const u of updates) {
            const keys = [...u.arg.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((k) => k[1]);
            if (keys.length === 0 || keys.some((k) => k !== 'username')) bad.push(`${u.where}: update(${u.arg.trim()})`);
        }
        expect(bad).toEqual([]);
    });
});

describe('reserved usernames are the same in the app and the database', () => {
    const fromSql = (sql: string, start: RegExp) => {
        const m = start.exec(sql);
        expect(m, `list not found for ${start}`).not.toBeNull();
        return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    };
    const app = [...RESERVED_USERNAMES].sort();

    it('lockdown-a trigger (enforced on every insert/update)', () => {
        expect(fromSql(SQL('2026-10-21-lockdown-a.sql'), /lower\(new\.username\)\s*=\s*any\s*\(array\[([\s\S]*?)\]\)/)).toEqual(app);
    });

    it('audit-tampering report', () => {
        expect(fromSql(SQL('audit-tampering.sql'), /lower\(username\)\s+in\s*\(([\s\S]*?)\)/)).toEqual(app);
    });
});
