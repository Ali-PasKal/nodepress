import 'reflect-metadata';
import type { Server } from 'node:http';
import { Logger } from 'nestjs-pino';
import { createApp } from './bootstrap/create-app.js';
import { ConfigValidationError, loadConfig } from './config/env.schema.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  const server: Server = app.getHttpServer();
  // Transport-level limits complement the per-handler TimeoutInterceptor.
  // Uploads may legitimately take longer than other requests (their own route timeout applies).
  server.requestTimeout =
    Math.max(config.http.requestTimeoutMs, config.media.uploadTimeoutMs) + 5_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;

  await app.listen(config.http.port, config.http.host);
  const logger = app.get(Logger);
  logger.log(
    {
      host: config.http.host,
      port: config.http.port,
      env: config.env,
      openapi: config.openapi.enabled,
    },
    'NEXORA API listening',
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during startup:', error);
  }
  process.exit(1);
});
