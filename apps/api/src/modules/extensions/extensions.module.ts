import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PLUGIN_PACKAGE_LIMITS } from '@nexora/plugin-runtime';
import { BundledPlugins } from './bundled-plugins.js';
import { PluginCapabilities } from './plugin-capabilities.js';
import { PluginEventsService } from './plugin-events.service.js';
import { PluginRegistry } from './plugin-registry.js';
import { PluginRuntimeService } from './plugin-runtime.service.js';
import { PluginShortcodesService } from './plugin-shortcodes.service.js';
import { PluginsController } from './plugins.controller.js';
import { PluginsService } from './plugins.service.js';
import { SafeFetch } from './safe-fetch.js';

/** Plugins: lifecycle, the sandbox runtime and the capabilities plugins may use. */
@Module({
  imports: [
    MulterModule.register({
      // One package per request, kept in memory (packages are stored in the database, never on disk).
      limits: {
        fileSize: PLUGIN_PACKAGE_LIMITS.maxPackageBytes,
        files: 1,
        fields: 2,
        fieldSize: 1_024,
        parts: 4,
        headerPairs: 50,
      },
    }),
  ],
  controllers: [PluginsController],
  providers: [
    { provide: SafeFetch, useFactory: () => new SafeFetch() },
    BundledPlugins,
    PluginCapabilities,
    PluginEventsService,
    PluginRegistry,
    PluginRuntimeService,
    PluginShortcodesService,
    PluginsService,
  ],
  exports: [PluginEventsService, PluginShortcodesService],
})
export class ExtensionsModule {}
