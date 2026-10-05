
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // Integration tests use real sockets and a solver with ~2s tail latency;
        // the default 5s per-test timeout is too tight for them.
        testTimeout: 20_000,
        // test/db needs a running local Supabase, so it is NOT part of the
        // default run — invoke it explicitly with `npm run test:db`.
        exclude: ['node_modules', 'dist', 'test/db/**'],
    },
});
