import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Sandbox tests start child processes and run code until its deadline.
    testTimeout: 30_000,
  },
});
