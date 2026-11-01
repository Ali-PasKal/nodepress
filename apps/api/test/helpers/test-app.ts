import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { createApp, type CreateAppOptions } from '../../src/bootstrap/create-app.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { loadConfig } from '../../src/config/env.schema.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_DATABASE_URL } from './test-env.js';

export const TEST_MEDIA_DIR = mkdtempSync(join(tmpdir(), 'nexora-test-media-'));

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: AppConfig;
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Boots the real application (same middleware stack as production) from an explicit environment.
 * The base environment is fixed rather than inherited from process.env so results never depend on
 * a developer's shell.
 */
export async function createTestApp(
  overrides: Record<string, string> = {},
  options: CreateAppOptions = {},
): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_CONNECT_TIMEOUT_MS: '1000',
    HEALTH_CHECK_TIMEOUT_MS: '1500',
    // Tests drive the worker explicitly (JobWorker.drain/start) so results are deterministic.
    JOBS_WORKER: 'off',
    MEDIA_LOCAL_DIR: TEST_MEDIA_DIR,
    ...overrides,
  });
  const app = await createApp(config, options);
  await app.init();
  return {
    app,
    config,
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}
