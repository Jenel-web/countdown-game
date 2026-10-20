/**
 * Proves the hand-run simulation scripts (scripts/attack-sim.ts, scripts/flood-sim.ts)
 * actually work: they are driven against the in-memory test server, so a script
 * that silently reported "defended" for the wrong reason would fail here.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createMockAdminClient, type MockAdminClient } from './helpers/mockAdminClient';

vi.mock('../../src/supabase/adminClient', () => ({ adminClient: createMockAdminClient() }));
import { adminClient } from '../../src/supabase/adminClient';
const mockAdmin = adminClient as unknown as MockAdminClient;

import type { TestServerHandle } from './helpers/testServer';
import { assertLocalhost, runAttackSuite } from '../../scripts/attack-sim';
import { floodBig, floodConnections, floodEvents } from '../../scripts/flood-sim';

let server: TestServerHandle;
beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { startTestServer } = await import('./helpers/testServer');
  server = await startTestServer();
});
afterAll(async () => {
  await server?.close();
});

describe('assertLocalhost', () => {
  it.each(['http://localhost:4000', 'http://127.0.0.1:4000', 'http://[::1]:4000'])('allows %s', (u) => {
    expect(() => assertLocalhost(u)).not.toThrow();
  });
  it.each([
    'https://countdown-server.onrender.com',
    'http://example.com',
    'http://10.0.0.5:4000',
    'http://localhost.evil.com',
    'http://192.168.1.10:4000',
  ])('refuses %s', (u) => {
    expect(() => assertLocalhost(u)).toThrow(/Refusing/);
  });
});

describe('attack-sim against the hardened server', () => {
  it('reports every exercised attack as DEFENDED', async () => {
    const matchId = randomUUID();
    mockAdmin.__state.matches.push({ id: matchId, player1_id: 'sim-a', player2_id: null, status: 'pending', winner_id: null });
    const lines: string[] = [];
    const findings = await runAttackSuite({ url: server.url, tokenA: 'sim-a', tokenB: 'sim-b', matchId, log: (l) => lines.push(l) });

    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    for (const id of ['S1', 'S2', 'S3', 'S5', 'S6', 'S7']) {
      expect(byId[id], `${id} should have run`).toBeDefined();
      expect(byId[id].defended, `${id}: ${byId[id].observed}`).toBe(true);
    }
    expect(byId.S4.defended).toBe('n/a'); // test mode has no prep window
    expect(lines.join('\n')).toContain('DEFENDED');
    expect(lines.join('\n')).not.toContain('VULNERABLE');
    // It must not have changed anyone's record: nobody forfeited, nothing finished.
    expect(mockAdmin.__state.finishMatchCalls.filter((c) => c.p_match_id === matchId)).toHaveLength(0);
  }, 60_000);
});

describe('flood-sim', () => {
  it('events: the report shows the flood was cut down and the flooder disconnected', async () => {
    const r = await floodEvents(server.url, 'flood-user-1', 500);
    const answered = Number(/answered\) (\d+) of/.exec(r.lines.join('\n'))?.[1]);
    expect(answered).toBeLessThanOrEqual(8);
    expect(r.lines.join('\n')).toMatch(/DISCONNECTED/);
  }, 20_000);

  it('conns: bounded by the per-account cap', async () => {
    const r = await floodConnections(server.url, 'flood-user-2', 40);
    const accepted = Number(/accepted: (\d+)/.exec(r.lines.join('\n'))?.[1]);
    expect(accepted).toBeLessThan(40);
    expect(r.lines.join('\n')).toMatch(/Too many open connections/);
  }, 20_000);

  it('big: both oversized packets close the connection', async () => {
    const r = await floodBig(server.url, 'flood-user-3');
    expect(r.lines.filter((l) => /CLOSED/.test(l))).toHaveLength(2);
  }, 20_000);
});
