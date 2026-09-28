/**
 * =============================================================================
 * FILE: test/db/finish_match.db.test.ts
 * TIER 3 — REAL DATABASE TESTS. These run against a LOCAL Supabase instance
 * (Docker), never your production project.
 *
 * WHY THIS TIER EXISTS: the mocked integration tests prove our TypeScript
 * calls finish_match with the right arguments — they say NOTHING about
 * whether the SQL function itself, or your RLS policies and column-level
 * GRANTs, actually behave correctly. Security rules are exactly the kind
 * of thing that silently "look right" and are wrong. Only a real Postgres
 * can tell you.
 *
 * SETUP (once):
 *   1. Install Docker + the Supabase CLI.
 *   2. In your project:   supabase start
 *   3. Apply your schema + the RLS/finish_match SQL to the LOCAL database
 *      (e.g. paste it into the local Studio SQL editor, or keep it in
 *      supabase/migrations/ so `supabase db reset` rebuilds it).
 *   4. `supabase status` prints the local API URL, anon key and
 *      service_role key. Export them:
 *        LOCAL_SUPABASE_URL=http://127.0.0.1:54321
 *        LOCAL_SUPABASE_ANON_KEY=...
 *        LOCAL_SUPABASE_SERVICE_KEY=...
 *
 * RUN:   npm run test:db
 * If the env vars are missing, every test here is SKIPPED (not failed).
 *
 * NOTE — NOT YET RUN: this file was written against the schema in our
 * earlier SQL (profiles.wins / losses / matches_played; matches.p1_score /
 * p2_score / status 'waiting'|'in_progress'|'completed'). If your real
 * columns differ (your profiles table now has `email`, `mmr`), adjust the
 * marked spots. Treat the first run as a shakedown.
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const haveEnv = Boolean(URL && ANON && SERVICE);

describe.skipIf(!haveEnv)('finish_match + matches RLS (real local Supabase)', () => {
    let admin: SupabaseClient; // service role: bypasses RLS, used for setup/verification only

    beforeAll(() => {
        admin = createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
    });

    /** Creates a real auth user (+ profile if your trigger doesn't) and returns a signed-in client. */
    async function createPlayer(label: string) {
        const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
        const password = 'test-password-123';

        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw error ?? new Error('createUser failed');
        const id = data.user.id;

        // ADJUST: if your handle_new_user() trigger already creates the profile row,
        // this upsert is harmless. If not, it is what creates it. Add any NOT NULL
        // columns your profiles table requires (e.g. `email`).
        await admin.from('profiles').upsert({ id, email, wins: 0, losses: 0, matches_played: 0 });

        const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: signInError } = await client.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;

        return { id, email, client };
    }

    async function seedActiveMatch(p1: string, p2: string) {
        const id = randomUUID();
        // Setup via service role, since regular players can't insert an in-progress match.
        const { error } = await admin
            .from('matches')
            .insert({ id, player1_id: p1, player2_id: p2, status: 'in_progress' }); // ADJUST status value if yours differs
        if (error) throw error;
        return id;
    }

    it('finish_match completes the match and updates BOTH players\' stats atomically', async () => {
        const a = await createPlayer('a');
        const b = await createPlayer('b');
        const matchId = await seedActiveMatch(a.id, b.id);

        const { error } = await admin.rpc('finish_match', {
            p_match_id: matchId,
            p_winner_id: a.id,
            p_loser_id: b.id,
            p_winner_score: 520,
            p_loser_score: 310,
        });
        expect(error).toBeNull();

        const { data: match } = await admin.from('matches').select('*').eq('id', matchId).single();
        expect(match!.status).toBe('completed');
        expect(match!.winner_id).toBe(a.id);
        expect(match!.p1_score).toBe(520); // player1 was the winner
        expect(match!.p2_score).toBe(310);
        expect(match!.ended_at).not.toBeNull();

        const { data: winner } = await admin.from('profiles').select('*').eq('id', a.id).single();
        const { data: loser } = await admin.from('profiles').select('*').eq('id', b.id).single();
        expect(winner!.wins).toBe(1);
        expect(winner!.matches_played).toBe(1);
        expect(loser!.losses).toBe(1);
        expect(loser!.matches_played).toBe(1);
    });

    it('is idempotent: calling finish_match twice does NOT double-count wins/losses', async () => {
        const a = await createPlayer('a');
        const b = await createPlayer('b');
        const matchId = await seedActiveMatch(a.id, b.id);
        const args = { p_match_id: matchId, p_winner_id: a.id, p_loser_id: b.id, p_winner_score: 500, p_loser_score: 200 };

        await admin.rpc('finish_match', args);
        await admin.rpc('finish_match', args); // e.g. a network retry, or the disconnect race we found

        const { data: winner } = await admin.from('profiles').select('wins, matches_played').eq('id', a.id).single();
        expect(winner!.wins).toBe(1);
        expect(winner!.matches_played).toBe(1);
    });

    it('rejects winner/loser ids that are not the two players on the match', async () => {
        const a = await createPlayer('a');
        const b = await createPlayer('b');
        const outsider = await createPlayer('outsider');
        const matchId = await seedActiveMatch(a.id, b.id);

        const { error } = await admin.rpc('finish_match', {
            p_match_id: matchId,
            p_winner_id: outsider.id, // not on this match
            p_loser_id: b.id,
            p_winner_score: 500,
            p_loser_score: 0,
        });
        expect(error).not.toBeNull();
    });

    it('a normal signed-in player CANNOT call finish_match themselves (cheating vector)', async () => {
        const a = await createPlayer('cheater');
        const b = await createPlayer('victim');
        const matchId = await seedActiveMatch(a.id, b.id);

        const { error } = await a.client.rpc('finish_match', {
            p_match_id: matchId,
            p_winner_id: a.id, // cheater tries to crown themselves
            p_loser_id: b.id,
            p_winner_score: 999,
            p_loser_score: 0,
        });
        expect(error).not.toBeNull(); // EXECUTE was revoked from `authenticated`

        const { data: match } = await admin.from('matches').select('status, winner_id').eq('id', matchId).single();
        expect(match!.status).toBe('in_progress');
        expect(match!.winner_id).toBeNull();
    });

    it('a player CANNOT smuggle winner_id/scores into an UPDATE (column-level GRANT)', async () => {
        const a = await createPlayer('host');
        const b = await createPlayer('joiner');

        // Host creates a legitimate waiting match via the real INSERT policy.
        const matchId = randomUUID();
        const { error: insertError } = await a.client
            .from('matches')
            .insert({ id: matchId, player1_id: a.id, status: 'waiting' });
        expect(insertError).toBeNull();

        // Joiner tries a legitimate-looking join that ALSO sets winner_id.
        const { error } = await b.client
            .from('matches')
            .update({ player2_id: b.id, status: 'in_progress', winner_id: b.id })
            .eq('id', matchId);
        expect(error).not.toBeNull(); // permission denied for column winner_id

        const { data: match } = await admin.from('matches').select('winner_id, player2_id').eq('id', matchId).single();
        expect(match!.winner_id).toBeNull();
        expect(match!.player2_id).toBeNull();
    });
});