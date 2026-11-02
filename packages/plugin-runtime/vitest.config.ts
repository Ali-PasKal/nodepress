import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One module cache per package: packages are tested in parallel, and a cache shared at the workspace
    // root can be cleared by one Vitest process while another is using it.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Sandbox tests start child processes and run code until its deadline.
    testTimeout: 30_000,
  },
});
