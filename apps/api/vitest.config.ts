import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/helpers/test-env.js';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one database; run files sequentially to keep them deterministic.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
