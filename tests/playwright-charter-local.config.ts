import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'charter-local-stability.spec.ts',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/charter-local/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4177',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node tests/charter-local-server.mjs',
    cwd: '..',
    url: 'http://127.0.0.1:4177',
    timeout: 30000,
    reuseExistingServer: false,
  },
});
