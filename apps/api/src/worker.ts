import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ConfigValidationError, loadConfig } from './config/env.schema.js';

/**
 * Standalone background worker: the same modules as the API (so every job handler is registered) without
 * an HTTP server. Run it alongside API processes started with JOBS_WORKER=off.
 */
async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, JOBS_WORKER: 'embedded' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot(config, { role: 'worker' }),
    { bufferLogs: true, abortOnError: false },
  );
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  await app.init();
  app.get(Logger).log({ concurrency: config.jobs.concurrency }, 'NEXORA worker running');
}

main().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during worker startup:', error);
  }
  process.exit(1);
});
