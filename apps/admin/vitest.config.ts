import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // One module cache per package: packages are tested in parallel, and a cache shared at the workspace
    // root can be cleared by one Vitest process while another is using it.
    fsModuleCachePath: new URL('./node_modules/.vitest-cache', import.meta.url).pathname,
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
