#!/usr/bin/env node
// nexora-plugin: check and package a NEXORA plugin folder.
//   nexora-plugin check <folder>
//   nexora-plugin pack <folder> [--out <file.zip>]
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { packPluginDirectory, readPluginDirectory } from '../dist/pack.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});
const [command, folder] = positionals;

function describeError(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  return [
    error?.message ?? String(error),
    ...issues.map((issue) => `  ${issue.path || '(manifest)'}: ${issue.message}`),
  ].join('\n');
}

if (values.help || !folder || (command !== 'pack' && command !== 'check')) {
  console.log(
    'Usage: nexora-plugin check <folder>\n       nexora-plugin pack <folder> [--out <file.zip>]',
  );
  process.exit(values.help ? 0 : 1);
}
try {
  const directory = resolve(folder);
  if (command === 'check') {
    const plugin = readPluginDirectory(directory);
    console.log(
      `${plugin.manifest.name} ${plugin.manifest.version} (${plugin.manifest.id}) is valid.`,
    );
  } else {
    const { buffer, plugin, files } = packPluginDirectory(directory);
    const out = resolve(values.out ?? `${plugin.manifest.id}-${plugin.manifest.version}.zip`);
    writeFileSync(out, buffer);
    console.log(`Packed ${files.join(', ')} → ${basename(out)} (${String(buffer.length)} bytes)`);
  }
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
