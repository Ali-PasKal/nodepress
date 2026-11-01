import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './app-config.js';

/** Which entry point is running: the HTTP API or the standalone background worker. */
export type ProcessRole = 'api' | 'worker';
export const PROCESS_ROLE = Symbol('PROCESS_ROLE');

/**
 * Provides the already-validated AppConfig to the whole application. Configuration is loaded and
 * validated before Nest boots (see bootstrap), so an invalid environment never reaches the DI container.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig, role: ProcessRole = 'api'): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PROCESS_ROLE, useValue: role },
      ],
      exports: [APP_CONFIG, PROCESS_ROLE],
    };
  }
}
