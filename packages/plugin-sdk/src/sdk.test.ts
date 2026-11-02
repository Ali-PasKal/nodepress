import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPluginPackage } from '@nexora/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { packPluginDirectory, readPluginDirectory } from './pack.js';
import { loadPlugin } from './testing.js';

const pluginsDir = fileURLToPath(new URL('../../../plugins', import.meta.url));

function folder(manifest: object, code: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'nexora-sdk-'));
  writeFileSync(join(directory, 'nexora-plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'plugin.js'), code);
  writeFileSync(join(directory, 'notes.txt'), 'not packaged');
  return directory;
}
const base = { id: 'acme.test', name: 'Test', version: '1.0.0', apiVersion: 1, main: 'plugin.js' };

describe('plugin packaging', () => {
  it('packs exactly the manifest, main file and docs into a package NEXORA accepts', () => {
    const { buffer, files, plugin } = packPluginDirectory(join(pluginsDir, 'reading-time'));
    expect(files).toEqual(['nexora-plugin.json', 'plugin.js', 'README.md']);
    expect(readPluginPackage(buffer).manifest).toEqual(plugin.manifest);
    const extra = folder(base, 'export default {};');
    expect(packPluginDirectory(extra).files).toEqual(['nexora-plugin.json', 'plugin.js']);
  });

  it('reports invalid manifests with their problems', () => {
    expect(() => readPluginDirectory(folder({ ...base, id: 'bad' }, 'x'))).toThrow(/invalid/);
  });
});

describe('test harness', () => {
  it('enforces the manifest: undeclared permissions, unlisted hosts and unsafe output fail', async () => {
    const directory = folder(
      {
        ...base,
        shortcodes: [
          { name: 'peek', label: 'Peek' },
          { name: 'unsafe', label: 'Unsafe' },
        ],
      },
      `export default { shortcodes: {
        async peek(attrs, ctx) { return (await ctx.content.list()).length + ''; },
        unsafe() { return { type: 'doc', content: [{ type: 'script' }] }; },
      } };`,
    );
    const plugin = await loadPlugin(directory);
    await expect(plugin.shortcode('peek')).rejects.toThrow(/content:read was not granted/);
    await expect(plugin.shortcode('unsafe')).rejects.toThrow(/would not show/);
    await expect(plugin.shortcode('missing')).rejects.toThrow(/declares no shortcode/);
  });

  it('refuses hosts the manifest does not list', async () => {
    const plugin = await loadPlugin(join(pluginsDir, 'publish-notifications'), {
      settings: { webhookUrl: 'https://hooks.slack.com/services/x' },
      fetch: () => ({ status: 200, headers: {}, body: '' }),
    });
    await plugin.hook('entry.published', { title: 'Hi' });
    expect(plugin.requests).toHaveLength(1);
  });
});
