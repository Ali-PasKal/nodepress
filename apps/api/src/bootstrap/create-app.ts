import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AppModule } from '../app.module.js';
import { createRequestIdMiddleware } from '../common/http/request-id.middleware.js';
import type { AppConfig } from '../config/app-config.js';
import { applyHttpSecurity } from './http-security.js';
import { setupOpenApi } from './openapi.js';

export interface CreateAppOptions {
  /** Mount the Swagger UI / OpenAPI routes (defaults to config.openapi.enabled). */
  readonly openapi?: boolean;
  /** Log sink override (used by tests to capture structured log output). */
  readonly logDestination?: DestinationStream;
}

/**
 * Builds a fully configured (but not yet listening) application. Shared by the server entrypoint,
 * integration tests and tooling so all of them exercise the same middleware stack.
 *
 * Middleware order matters: request id → security headers → no-store → CORS → JSON body parser
 * (size-limited) → Nest router (logging, versioned routes, interceptors, exception filter).
 */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const appModule = AppModule.forRoot(
    config,
    options.logDestination ? { logDestination: options.logDestination } : {},
  );
  const app = await NestFactory.create<NestExpressApplication>(appModule, {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const { trustProxy } = config.http;
  app.set('trust proxy', typeof trustProxy === 'object' ? [...trustProxy] : trustProxy);
  app.use(createRequestIdMiddleware(config.http.trustRequestIdHeader));
  applyHttpSecurity(app, config);
  // JSON is the only accepted request body format; anything larger than the limit is rejected with 413.
  app.useBodyParser('json', { limit: config.http.bodyLimit, strict: true });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (options.openapi ?? config.openapi.enabled) {
    setupOpenApi(app);
  }
  return app;
}
