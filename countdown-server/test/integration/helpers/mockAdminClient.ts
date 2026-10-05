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
    status: 'waiting' | 'active' | 'finished';
    winner_id: string | null;
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
export function createMockAdminClient() {
    const matches: FakeMatchRow[] = [];
    const rounds: FakeRoundRow[] = [];
    const finishMatchCalls: FinishMatchCall[] = [];
    // Simulated network latency for rpc(), in ms. Real Supabase calls take tens of
    // milliseconds; an instant mock hides race conditions that only appear when
    // an `await` actually yields control to other pending events.
    let rpcLatencyMs = 0;

    return {
        // Exposed so tests can seed data and make assertions directly, e.g.
        // mockAdminClient.__state.matches.push({...}) before starting a test,
        // or expect(mockAdminClient.__state.rounds).toHaveLength(1) after.
        __state: { matches, rounds, finishMatchCalls },
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

        from(table: 'matches' | 'rounds') {
            if (table === 'matches') {
                return {
                    select() {
                        return {
                            eq(_column: 'id', value: string) {
                                return {
                                    async single() {
                                        const row = matches.find((m) => m.id === value);
                                        if (!row) {
                                            return { data: null, error: new Error('not found') };
                                        }
                                        return { data: row, error: null };
                                    },
                                };
                            },
                        };
                    },
                    update(patch: Partial<FakeMatchRow>) {
                        return {
                            eq(_column: 'id', value: string) {
                                const row = matches.find((m) => m.id === value);
                                if (row) Object.assign(row, patch);
                                // Real supabase-js update() returns a thenable/promise-like
                                // builder; our handlers only ever check `.error`, so a
                                // resolved promise with { error: null } is sufficient here.
                                return Promise.resolve({ error: row ? null : new Error('not found') });
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
                row.status = 'finished';
                row.winner_id = args.p_winner_id;
            }
            return { error: null };
        },
    };
}

export type MockAdminClient = ReturnType<typeof createMockAdminClient>;