import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { ADMIN_SECURITY_HEADERS } from './security-headers.ts';

// The admin is served under /admin/ and talks to the API on the same origin (/api). During
// development and preview, Vite proxies /api and /uploads to the API process and every other path to
// the public site runtime, so admin, API and site share one origin (as behind nginx in production).
const apiTarget = process.env.NEXORA_API_URL ?? 'http://127.0.0.1:3000';
const siteTarget = process.env.NEXORA_SITE_URL ?? 'http://127.0.0.1:4321';
const proxy = {
  '/api': { target: apiTarget },
  '/uploads': { target: apiTarget },
  '^/(?!admin(?:/|$)|api(?:/|$)|uploads(?:/|$)).*': { target: siteTarget },
};

export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    // Production security headers (the dev server omits them: React Fast Refresh needs inline scripts).
    headers: { ...ADMIN_SECURITY_HEADERS },
    proxy,
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks change rarely, so browsers keep them cached across admin releases.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/, priority: 20 },
            // src/zod-config.ts must share Zod's chunk: every chunk that constructs schemas imports
            // this one, so Zod's jitless switch runs before any schema exists. Constructing a schema
            // first makes Zod probe for eval, which the strict CSP reports as a violation (covered by
            // the "no Content Security Policy violations" E2E test).
            {
              name: 'data',
              test: /node_modules[\\/](zod|@tanstack)[\\/]|[\\/]src[\\/]zod-config\.ts$/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
