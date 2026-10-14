import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Root-level Vitest configuration for Next.js frontend tests
 * (e.g. app/auth/callback/route.test.ts).
 *
 * Resolves the `@/` path alias to the project root so that test files
 * can import `@/lib/supabase/server` and similar paths the same way
 * the application code does.
 *
 * The countdown-server sub-package has its own vitest.config.ts that
 * governs only the files inside countdown-server/.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    // Exclude the game server's own test folder — it has a separate config
    exclude: ['**/node_modules/**', 'countdown-server/**'],
  },
});
