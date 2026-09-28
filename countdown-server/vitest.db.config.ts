import { defineConfig } from 'vitest/config';

// Separate config for the real-database tier so its (different) include
// rules and longer timeouts never leak into the fast default suite.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/db/**/*.db.test.ts'],
        testTimeout: 30_000,
    },
});
