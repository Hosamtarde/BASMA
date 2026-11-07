import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4320);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E against the real thing: the built API serves the built UI on one loopback origin with a
 * fresh PostgreSQL database (ADR-0017). Run `npm run test:e2e:web` from the repo root.
 * Local runs use the installed Microsoft Edge; CI uses Playwright's Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 768 },
  },
  projects: [
    {
      name: 'chromium',
      use: process.env.CI
        ? { ...devices['Desktop Chrome'] }
        : { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  webServer: {
    command: 'node ../api/scripts/serve-e2e.cjs',
    url: `${baseURL}/api/v1/health/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT), E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? '' },
  },
});
