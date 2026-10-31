import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end tests run the production admin build (vite preview) against a real API process and a
 * real PostgreSQL database, at desktop, tablet and mobile viewport sizes.
 */
const isCI = process.env.CI !== undefined;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_e2e';
const API_PORT = 3199;
const ADMIN_PORT = 4199;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(ADMIN_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      // Build the API, apply migrations to the E2E database, then start the server.
      command:
        'pnpm --filter @nexora/api run build && pnpm --filter @nexora/api exec prisma migrate deploy && pnpm --filter @nexora/api run start',
      cwd: repoRoot,
      url: `http://127.0.0.1:${String(API_PORT)}/api/v1/health/live`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port ${String(ADMIN_PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(ADMIN_PORT)}/admin/`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { NEXORA_API_URL: `http://127.0.0.1:${String(API_PORT)}` },
    },
  ],
});
