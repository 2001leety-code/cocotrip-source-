import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  envDir: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/integration/charter-inquiry-storage.test.tsx'],
    setupFiles: ['./tests/unit/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
