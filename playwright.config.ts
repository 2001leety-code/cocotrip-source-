import { defineConfig, devices } from '@playwright/test';

// Note: previously imported `dotenv` for local .env loading, but the package
// was never declared in package.json — CI failed with ERR_MODULE_NOT_FOUND
// the first time pr-i18n-smoke ran (PRs #63-#66). For local .env support,
// run with `--env-file` (Node 20.6+) or prepend env vars on the command line.

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000, 
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: 'tests/report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://cocotripkr.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Pixel 5', use: { ...devices['Pixel 5'] } },
    { name: 'iPhone 14 Pro', use: { ...devices['iPhone 14 Pro'] } },
  ],
});
