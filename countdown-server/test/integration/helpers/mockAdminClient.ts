/**
 * =============================================================================
 * FILE: test/integration/helpers/mockAdminClient.ts
 * RESPONSIBILITY: A fake, in-memory stand-in for the real Supabase admin
 * client, implementing exactly the handful of calls our handlers actually
 * make: auth.getUser, from('matches').select/update, from('rounds').insert,
 * and rpc('finish_match', ...).
 *
 * WHY A HAND-WRITTEN FAKE INSTEAD OF A GENERIC MOCKING LIBRARY:
 * Supabase's real client has a large, deeply chainable API surface
 * (.from().select().eq().single(), etc). Trying to auto-mock all of that
 * is more work and more fragile than just implementing the handful of
 * calls this specific codebase actually uses, backed by plain in-memory
 * arrays. This also happens to double as executable documentation of
 * exactly what our handlers expect from Supabase.
 *
 * IMPORTANT: this file is loaded via vi.mock() INSIDE each integration
 * test file (see match-flow.integration.test.ts for the exact pattern),
 * not imported directly — Vitest's module mocking has to replace
 * '../../../src/supabase/adminClient' everywhere it's imported
 * (authMiddleware.ts, roomHandlers.ts, roundHandlers.ts) with this fake,
 * and vi.mock is how that substitution happens.
 * =============================================================================
 */

export interface FakeMatchRow {
    id: string;
    player1_id: string;
    player2_id: string | null;
    status: 'waiting' | 'pending' | 'active' | 'completed';
    winner_id: string | null;
    ended_at?: string | null;
}

export interface FakeRoundRow {
    match_id: string;
    round_number: number;
    target: number;
    tiles: unknown;
    solvable: boolean;
    player1_result: number | null;
    player2_result: number | null;
    player1_time_ms: number | null;
    player2_time_ms: number | null;
    player1_points: number;
    player2_points: number;
    player1_outcome: string;
    player2_outcome: string;
    player1_steps?: unknown;
    player2_steps?: unknown;
}

export interface FinishMatchCall {
    p_match_id: string;
    p_winner_id: string;
    p_loser_id: string;
    p_winner_score: number;
    p_loser_score: number;
}

/**
 * Creates a fresh fake admin client with empty in-memory tables. Call this
 * ONCE per test file, inside the vi.mock() factory — see the usage note
 * in match-flow.integration.test.ts for exactly why the factory shape
 * matters here (Vitest's mock hoisting rules).
 */
export interface FakeProfileUpdate {
    id: string;
    patch: Partial<{ mmr: number; wins: number; losses: number }>;
}

export function createMockAdminClient() {
    const matches: FakeMatchRow[] = [];
    const rounds: FakeRoundRow[] = [];
    const finishMatchCalls: FinishMatchCall[] = [];
    const profileUpdates: FakeProfileUpdate[] = [];
    // Simulated network latency for rpc(), in ms. Real Supabase calls take tens of
    // milliseconds; an instant mock hides race conditions that only appear when
    // an `await` actually yields control to other pending events.
    let rpcLatencyMs = 0;

    return {
        // Exposed so tests can seed data and make assertions directly, e.g.
        // mockAdminClient.__state.matches.push({...}) before starting a test,
        // or expect(mockAdminClient.__state.rounds).toHaveLength(1) after.
        __state: { matches, rounds, finishMatchCalls, profileUpdates },
        __setRpcLatency(ms: number) {
            rpcLatencyMs = ms;
        },

        auth: {
            // In real life this verifies a JWT against Supabase. In tests, we
            // sidestep real JWT verification entirely — the "token" our test
            // clients send IS the desired fake userId. This keeps these tests
            // focused on OUR game logic, not on re-testing Supabase's own,
            // already-reliable auth verification.
            async getUser(token: string) {
                if (!token) {
                    return { data: { user: null }, error: new Error('no token provided') };
                }
                return { data: { user: { id: token } }, error: null };
            },
        },

        from(table: 'matches' | 'rounds' | 'profiles') {
            if (table === 'profiles') {
                return {
                    select() {
                        return {
                            in(_column: string, ids: string[]) {
                                return Promise.resolve({
                                    data: ids.map((id) => ({ id, mmr: 1000, wins: 0, losses: 0 })),
                                    error: null,
                                });
                            },
                        };
                    },
                    update(patch: Partial<{ mmr: number; wins: number; losses: number }>) {
                        return {
                            eq(_column: 'id', value: string) {
                                profileUpdates.push({ id: value, patch });
                                return Promise.resolve({ error: null });
                            },
                        };
                    },
                };
            }

            if (table === 'matches') {
                /**
                 * Minimal stand-in for supabase-js's filter builder: any number of
                 * chained .eq()/.neq() calls, then either awaited directly (update /
                 * delete) or finished with .single() (select). Matches the way the
                 * handlers really chain their queries, so a handler that forgets a
                 * status guard behaves differently here than one that has it.
                 */
                const makeFilter = (run: (rows: FakeMatchRow[]) => { data?: unknown; error: Error | null }) => {
                    const preds: Array<(r: FakeMatchRow) => boolean> = [];
                    const builder = {
                        eq(column: string, value: unknown) {
                            preds.push((r) => (r as unknown as Record<string, unknown>)[column] === value);
                            return builder;
                        },
                        neq(column: string, value: unknown) {
                            preds.push((r) => (r as unknown as Record<string, unknown>)[column] !== value);
                            return builder;
                        },
                        async single() {
                            const found = matches.filter((r) => preds.every((p) => p(r)));
                            if (found.length !== 1) return { data: null, error: new Error('not found') };
                            return { data: found[0], error: null };
                        },
                        then(onFulfilled: (v: { error: Error | null }) => unknown, onRejected?: (e: unknown) => unknown) {
                            const found = matches.filter((r) => preds.every((p) => p(r)));
                            return Promise.resolve(run(found)).then(onFulfilled, onRejected);
                        },
                    };
                    return builder;
                };

                return {
                    select() {
                        return makeFilter(() => ({ error: null }));
                    },
                    update(patch: Partial<FakeMatchRow>) {
                        return makeFilter((rows) => {
                            for (const row of rows) Object.assign(row, patch);
                            return { error: null };
                        });
                    },
                    delete() {
                        return makeFilter((rows) => {
                            for (const row of rows) matches.splice(matches.indexOf(row), 1);
                            return { error: null };
                        });
                    },
                    insert(row: Partial<FakeMatchRow>) {
                        const inserted: FakeMatchRow = {
                            id: `rematch-${matches.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
                            player1_id: row.player1_id!,
                            player2_id: row.player2_id ?? null,
                            status: row.status ?? 'pending',
                            winner_id: null,
                        };
                        matches.push(inserted);
                        return {
                            select() {
                                return {
                                    async single() {
                                        return { data: { id: inserted.id }, error: null };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            // table === 'rounds'
            return {
                async insert(row: FakeRoundRow) {
                    rounds.push(row);
                    return { error: null };
                },
            };
        },

        async rpc(fnName: string, args: FinishMatchCall) {
            if (fnName !== 'finish_match') {
                throw new Error(`mockAdminClient: unexpected rpc call to "${fnName}"`);
            }
            finishMatchCalls.push(args);
            if (rpcLatencyMs > 0) await new Promise((r) => setTimeout(r, rpcLatencyMs));

            const row = matches.find((m) => m.id === args.p_match_id);
            if (row) {
                // Mirrors the real finish_match(): completes the row and stamps ended_at.
                row.status = 'completed';
                row.ended_at = new Date().toISOString();
                row.winner_id = args.p_winner_id;
            }
            return { error: null };
        },
    };
}

export type MockAdminClient = ReturnType<typeof createMockAdminClient>;