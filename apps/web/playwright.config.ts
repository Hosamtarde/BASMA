import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the real thing: the built API serves the built UI on one loopback origin, each
 * project with its own freshly reset PostgreSQL database (ADR-0017). Run `npm run test:e2e:web`
 * from the repo root with E2E_DATABASE_URL pointing at a database whose name ends with `_e2e`.
 *
 * - first-run: an empty installation (no owner). One serial file covers what needs it: the setup
 *   wizard, the currency and numbering locks appearing, the password change.
 * - app: an installation whose owner is seeded at start-up. Every test signs in itself, sets the
 *   language it checks and creates uniquely named data, so files and tests run in any order.
 *
 * Local runs use the installed Microsoft Edge; CI uses Playwright's Chromium.
 */
const FIRST_RUN_PORT = Number(process.env.E2E_PORT ?? 4320);
const APP_PORT = FIRST_RUN_PORT + 1;
// Same value as OWNER.password in e2e/support.ts.
const OWNER_PASSWORD = 'owner-pass-1234';

function databaseUrl(suffix: string): string {
  const base = process.env.E2E_DATABASE_URL ?? '';
  if (!base) return '';
  const url = new URL(base);
  // lab_e2e → lab_e2e (first run) and lab_app_e2e (app); both end with _e2e as the launcher requires.
  url.pathname = `/${decodeURIComponent(url.pathname.slice(1)).replace(/_e2e$/, '')}${suffix}`;
  return url.toString();
}

const browser = process.env.CI
  ? { ...devices['Desktop Chrome'] }
  : { ...devices['Desktop Edge'], channel: 'msedge' };

const server = (port: number, dbUrl: string, seedOwner: boolean) => ({
  command: 'node ../api/scripts/serve-e2e.cjs',
  url: `http://127.0.0.1:${port}/api/v1/health/ready`,
  reuseExistingServer: false,
  timeout: 120_000,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
  env: {
    E2E_PORT: String(port),
    E2E_DATABASE_URL: dbUrl,
    ...(seedOwner ? { E2E_SEED_OWNER_PASSWORD: OWNER_PASSWORD } : {}),
  },
});

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // One worker: the language and logo are per installation, so parallel tests would race on them.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'first-run',
      testMatch: /first-run\.spec\.ts$/,
      use: { ...browser, baseURL: `http://127.0.0.1:${FIRST_RUN_PORT}` },
    },
    {
      name: 'app',
      testIgnore: /first-run\.spec\.ts$/,
      use: { ...browser, baseURL: `http://127.0.0.1:${APP_PORT}` },
    },
  ],
  webServer: [
    server(FIRST_RUN_PORT, databaseUrl('_e2e'), false),
    server(APP_PORT, databaseUrl('_app_e2e'), true),
  ],
});
