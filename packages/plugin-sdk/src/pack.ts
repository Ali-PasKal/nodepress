import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLUGIN_PACKAGE_LIMITS,
  pluginPackageFromFiles,
  writePluginPackage,
  type PluginPackage,
  type ZipEntry,
} from '@nexora/plugin-runtime';
import { PLUGIN_MANIFEST_FILE } from '@nexora/shared';

/** Files a package may contain besides the manifest and the main file. */
const EXTRA_FILES = ['README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'CHANGELOG.md'];

function readFile(directory: string, name: string): ZipEntry | null {
  const path = join(directory, name);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  if (statSync(path).size > PLUGIN_PACKAGE_LIMITS.maxEntryBytes) {
    throw new Error(
      `${name} is larger than ${String(PLUGIN_PACKAGE_LIMITS.maxEntryBytes / 1024)} KB.`,
    );
  }
  return { name, data: readFileSync(path) };
}

/** Reads and validates a plugin folder (the manifest, its main file and README) like NEXORA would. */
export function readPluginDirectory(directory: string): PluginPackage & { files: ZipEntry[] } {
  const files: ZipEntry[] = [];
  const manifest = readFile(directory, PLUGIN_MANIFEST_FILE);
  if (!manifest) throw new Error(`${directory} has no ${PLUGIN_MANIFEST_FILE}.`);
  files.push(manifest);
  const parsed = JSON.parse(manifest.data.toString('utf8')) as { main?: unknown };
  if (typeof parsed.main === 'string' && !EXTRA_FILES.includes(parsed.main)) {
    const main = readFile(directory, parsed.main);
    if (main) files.push(main);
  }
  for (const name of EXTRA_FILES) {
    const file = readFile(directory, name);
    if (file) files.push(file);
  }
  const plugin = pluginPackageFromFiles(new Map(files.map((file) => [file.name, file])));
  return { ...plugin, files };
}

/** Builds the .zip package NEXORA accepts from a plugin folder (validated first). */
export function packPluginDirectory(directory: string): {
  buffer: Buffer;
  plugin: PluginPackage;
  files: string[];
} {
  const plugin = readPluginDirectory(directory);
  const buffer = writePluginPackage(plugin.files);
  if (buffer.length > PLUGIN_PACKAGE_LIMITS.maxPackageBytes) {
    throw new Error('The package is larger than 2 MB.');
  }
  return { buffer, plugin, files: plugin.files.map((file) => file.name) };
}
