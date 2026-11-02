import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { color, fail } from '../output.ts';

interface PackModule {
  readPluginDirectory(directory: string): {
    manifest: { id: string; name: string; version: string };
  };
  packPluginDirectory(directory: string): {
    buffer: Buffer;
    plugin: { manifest: { id: string; version: string } };
    files: string[];
  };
}

function describe(error: unknown): string {
  const issues = (error as { issues?: { path: string; message: string }[] }).issues ?? [];
  return [
    error instanceof Error ? error.message : String(error),
    ...issues.map((issue) => `  ${issue.path || '(manifest)'}: ${issue.message}`),
  ].join('\n');
}

/** `nexora plugin check|pack <folder>`: uses the plugin SDK (built by `pnpm build` or `pnpm run codegen`). */
export async function pluginCommand(
  action: string | undefined,
  folder: string | undefined,
  out: string | undefined,
): Promise<number> {
  if ((action !== 'check' && action !== 'pack') || folder === undefined) {
    fail('Usage: nexora plugin check <folder> | nexora plugin pack <folder> [--out <file.zip>]');
  }
  let sdk: PackModule;
  try {
    sdk = await import('@nexora/plugin-sdk/pack');
  } catch {
    fail('The plugin SDK is not built yet. Run "pnpm run codegen" (or "pnpm build") first.');
  }
  const directory = resolve(folder);
  try {
    if (action === 'check') {
      const { manifest } = sdk.readPluginDirectory(directory);
      console.log(`${color.bold(manifest.name)} ${manifest.version} (${manifest.id}) is valid.`);
      return 0;
    }
    const { buffer, plugin, files } = sdk.packPluginDirectory(directory);
    const target = resolve(out ?? `${plugin.manifest.id}-${plugin.manifest.version}.zip`);
    writeFileSync(target, buffer);
    console.log(
      `Packed ${files.join(', ')} → ${basename(target)} (${String(buffer.length)} bytes)`,
    );
    return 0;
  } catch (error) {
    fail(describe(error));
  }
}
