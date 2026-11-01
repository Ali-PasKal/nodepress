import { Module, type DynamicModule } from '@nestjs/common';
import type { DestinationStream } from 'pino';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter.js';
import { TimeoutInterceptor } from './common/http/timeout.interceptor.js';
import type { AppConfig } from './config/app-config.js';
import { ConfigModule, type ProcessRole } from './config/config.module.js';
import { CacheModule } from './infrastructure/cache/cache.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { buildLoggerOptions } from './logging/logger-options.js';
import { HealthModule } from './modules/health/health.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { SecurityModule } from './modules/security/security.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SetupModule } from './modules/setup/setup.module.js';
import { SitesModule } from './modules/sites/sites.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { LifecycleModule } from './common/lifecycle/lifecycle.module.js';

/**
 * Root module. Built from an already-validated config so tests can construct isolated application
 * instances with different settings.
 */
@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    options: { logDestination?: DestinationStream; role?: ProcessRole } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config, options.role ?? 'api'),
        LoggerModule.forRoot(buildLoggerOptions(config, options.logDestination)),
        LifecycleModule,
        DatabaseModule,
        CacheModule,
        SitesModule,
        AuditModule,
        JobsModule,
        MailModule,
        SecurityModule,
        HealthModule,
        SystemModule,
        SetupModule,
        AuthModule,
        AccountModule,
        UsersModule,
        RolesModule,
        SettingsModule,
        MaintenanceModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
      ],
    };
  }
}
