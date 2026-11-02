import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PLUGIN_PACKAGE_LIMITS,
  PluginPackageError,
  pluginPackageFromFiles,
  type PluginPackage,
  type ZipEntry,
} from '@nexora/plugin-runtime';
import { PLUGIN_MANIFEST_FILE } from '@nexora/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/**
 * First-party plugins shipped with NEXORA (one folder per plugin under PLUGINS_BUNDLED_DIR). They are read
 * like uploaded packages and run in the same sandbox: being first-party gives no extra trust.
 */
@Injectable()
export class BundledPlugins {
  private readonly logger = new Logger(BundledPlugins.name);
  private cache: Map<string, PluginPackage> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  all(): Map<string, PluginPackage> {
    if (this.cache) return this.cache;
    const found = new Map<string, PluginPackage>();
    const root = this.config.plugins.bundledDir;
    if (existsSync(root)) {
      for (const folder of readdirSync(root).sort()) {
        const directory = join(root, folder);
        if (
          !statSync(directory).isDirectory() ||
          !existsSync(join(directory, PLUGIN_MANIFEST_FILE))
        ) {
          continue;
        }
        try {
          const plugin = this.read(directory);
          found.set(plugin.manifest.id, plugin);
        } catch (error) {
          this.logger.warn(
            { folder, err: error instanceof PluginPackageError ? error.message : error },
            'Skipping an invalid bundled plugin',
          );
        }
      }
    }
    this.cache = found;
    return found;
  }

  get(key: string): PluginPackage | undefined {
    return this.all().get(key);
  }

  private read(directory: string): PluginPackage {
    const files = new Map<string, ZipEntry>();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (!statSync(path).isFile() || statSync(path).size > PLUGIN_PACKAGE_LIMITS.maxEntryBytes)
        continue;
      files.set(name, { name, data: readFileSync(path) });
    }
    return pluginPackageFromFiles(files);
  }
}
