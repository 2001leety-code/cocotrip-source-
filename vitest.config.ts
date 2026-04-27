import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Component tests (.test.tsx) override env via `// @vitest-environment jsdom` 헤더.
    // Pure function tests stay on node for speed.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      // Scope coverage to backend helpers + schemas — frontend components are
      // covered by Playwright e2e (tests/e2e/), not vitest. Adding more files
      // here without tests would just lower the score and force noisy thresholds.
      include: [
        'src/schemas/**',
        'api/_shared/log.js',
        'api/_shared/paypal.js',
        'api/_shared/response.js',
        'api/_shared/admin-auth.js',
        'api/_shared/firebase-admin.js',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // Per-file thresholds — every covered file must hold its own line.
        // Functions threshold is 65 not 70 because `text().catch(() => '')`
        // arrow fallback in paypal.js is hard to exercise (would need
        // text() that rejects, which fetch-mock doesn't naturally produce).
        // Raise as we add tests for firebase-admin.initAdminDb, admin-auth, etc.
        perFile: true,
        lines: 75,
        functions: 65,
        branches: 60,
        statements: 75,
      },
    },
  },
});
