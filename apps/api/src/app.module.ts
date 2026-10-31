import { Module, type DynamicModule } from '@nestjs/common';
import type { DestinationStream } from 'pino';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter.js';
import { TimeoutInterceptor } from './common/http/timeout.interceptor.js';
import type { AppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { CacheModule } from './infrastructure/cache/cache.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { buildLoggerOptions } from './logging/logger-options.js';
import { HealthModule } from './modules/health/health.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { LifecycleModule } from './common/lifecycle/lifecycle.module.js';

/**
 * Root module. Built from an already-validated config so tests can construct isolated application
 * instances with different settings.
 */
@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    options: { logDestination?: DestinationStream } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerOptions(config, options.logDestination)),
        LifecycleModule,
        DatabaseModule,
        CacheModule,
        HealthModule,
        SystemModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
      ],
    };
  }
}
