import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env files implicitly. For local development we load the repository-root
// .env if present; process.loadEnvFile never overrides variables that are already set, so real
// environment variables (CI, containers) always win.
const rootEnvFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// Migrations may use a more privileged role than the running application (least privilege).
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    ...(migrationUrl ? { url: migrationUrl } : {}),
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
