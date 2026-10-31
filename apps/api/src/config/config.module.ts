import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './app-config.js';

/**
 * Provides the already-validated AppConfig to the whole application. Configuration is loaded and
 * validated before Nest boots (see bootstrap), so an invalid environment never reaches the DI container.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
