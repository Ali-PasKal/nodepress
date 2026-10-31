/**
 * Writes the OpenAPI document to disk without starting a server or connecting to any database.
 * Usage: pnpm --filter @nexora/api run openapi:export [output-path]
 */
import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../bootstrap/create-app.js';
import { buildOpenApiDocument } from '../bootstrap/openapi.js';
import { loadConfig } from '../config/env.schema.js';

const defaultOutput = fileURLToPath(new URL('../../../../docs/api/openapi.json', import.meta.url));
const output = resolve(process.argv[2] ?? defaultOutput);

const config = loadConfig({
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  // Never contacted: Prisma connects lazily and no request is served.
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
});
const app = await createApp(config, { openapi: false });
await app.init();
const document = buildOpenApiDocument(app);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await app.close();
console.warn(`OpenAPI document written to ${output}`);
