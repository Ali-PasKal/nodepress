import { PLUGIN_MANIFEST_FILE, pluginManifestSchema, type PluginManifest } from '@nexora/shared';
import { readZip, writeZip, ZipError, type ZipEntry } from './zip.js';

/** Limits for plugin packages (uploads are additionally limited by the API's request size). */
export const PLUGIN_PACKAGE_LIMITS = {
  /** Size of the uploaded .zip. */
  maxPackageBytes: 2 * 1024 * 1024,
  maxEntries: 40,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxManifestBytes: 64 * 1024,
  maxCodeBytes: 512 * 1024,
  maxReadmeBytes: 64 * 1024,
} as const;

export class PluginPackageError extends Error {
  override readonly name = 'PluginPackageError';
  constructor(
    message: string,
    /** Field-level problems of an invalid manifest (`path` like `settings.0.default`). */
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export interface PluginPackage {
  readonly manifest: PluginManifest;
  /** The plugin's JavaScript (an ES module). */
  readonly code: string;
  readonly readme: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function text(entry: ZipEntry, label: string, maxBytes: number): string {
  if (entry.data.length > maxBytes) {
    throw new PluginPackageError(
      `${label} is larger than ${String(Math.round(maxBytes / 1024))} KB.`,
    );
  }
  try {
    // The decoder drops a leading byte-order mark.
    return utf8.decode(entry.data);
  } catch {
    throw new PluginPackageError(`${label} is not valid UTF-8 text.`);
  }
}

/** Validates a manifest object (already parsed JSON) and returns it with defaults applied. */
export function parsePluginManifest(value: unknown): PluginManifest {
  const result = pluginManifestSchema.safeParse(value);
  if (!result.success) {
    throw new PluginPackageError(
      `${PLUGIN_MANIFEST_FILE} is invalid.`,
      result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Builds a package from its files (as found in a folder or an archive). */
export function pluginPackageFromFiles(files: ReadonlyMap<string, ZipEntry>): PluginPackage {
  const manifestEntry = files.get(PLUGIN_MANIFEST_FILE);
  if (!manifestEntry) throw new PluginPackageError(`The package has no ${PLUGIN_MANIFEST_FILE}.`);
  let json: unknown;
  try {
    json = JSON.parse(
      text(manifestEntry, PLUGIN_MANIFEST_FILE, PLUGIN_PACKAGE_LIMITS.maxManifestBytes),
    );
  } catch (error) {
    if (error instanceof PluginPackageError) throw error;
    throw new PluginPackageError(`${PLUGIN_MANIFEST_FILE} is not valid JSON.`);
  }
  const manifest = parsePluginManifest(json);
  const main = files.get(manifest.main);
  if (!main)
    throw new PluginPackageError(`The package has no ${manifest.main} (the manifest's "main").`);
  const code = text(main, manifest.main, PLUGIN_PACKAGE_LIMITS.maxCodeBytes);
  if (code.trim() === '') throw new PluginPackageError(`${manifest.main} is empty.`);
  const readmeEntry = files.get('README.md');
  const readme = readmeEntry
    ? text(readmeEntry, 'README.md', PLUGIN_PACKAGE_LIMITS.maxReadmeBytes)
    : '';
  return { manifest, code, readme };
}

/**
 * Reads an uploaded plugin package (.zip). Files may sit at the archive root or in one top-level folder (as
 * when a folder is zipped). Throws `PluginPackageError` with a message suitable for the uploader.
 */
export function readPluginPackage(buffer: Buffer): PluginPackage {
  if (buffer.length > PLUGIN_PACKAGE_LIMITS.maxPackageBytes) {
    throw new PluginPackageError('The package is larger than 2 MB.');
  }
  let entries: ZipEntry[];
  try {
    entries = readZip(buffer, PLUGIN_PACKAGE_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new PluginPackageError(error.message);
    throw error;
  }
  const prefixes = new Set(entries.map((entry) => entry.name.split('/')[0]));
  const nested =
    !entries.some((entry) => entry.name === PLUGIN_MANIFEST_FILE) &&
    prefixes.size === 1 &&
    entries.every((entry) => entry.name.includes('/'));
  const files = new Map<string, ZipEntry>();
  for (const entry of entries) {
    const name = nested ? entry.name.slice(entry.name.indexOf('/') + 1) : entry.name;
    files.set(name, { name, data: entry.data });
  }
  return pluginPackageFromFiles(files);
}

/** Writes a package archive from a plugin's files (used by `nexora plugin pack` and tests). */
export function writePluginPackage(files: readonly ZipEntry[]): Buffer {
  return writeZip(files);
}
