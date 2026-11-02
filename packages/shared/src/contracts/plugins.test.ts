import { describe, expect, it } from 'vitest';
import {
  buildPluginSettingsSchema,
  buildPluginShortcodeAttrsSchema,
  comparePluginVersions,
  maskPluginSettings,
  pluginManifestSchema,
  pluginShortcodeOutputSchema,
  resolvePluginSettings,
  type PluginSettingDefinition,
} from './plugins.js';

const base = {
  id: 'acme.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: 1,
  main: 'plugin.js',
};

describe('plugin manifest', () => {
  it('accepts a complete manifest and applies defaults', () => {
    const manifest = pluginManifestSchema.parse({
      ...base,
      permissions: ['content:read', 'http:fetch'],
      hosts: ['hooks.slack.com'],
      settings: [
        { key: 'wpm', label: 'Words per minute', type: 'number', min: 50, max: 1000, default: 200 },
      ],
      shortcodes: [
        {
          name: 'reading_time',
          label: 'Reading time',
          attributes: {
            label: { type: 'string' },
            round: { type: 'enum', values: ['up', 'down'] },
          },
        },
      ],
      hooks: ['entry.published'],
    });
    expect(manifest.description).toBe('');
    expect(manifest.settings[0]).toMatchObject({ integer: true, description: '' });
    expect(manifest.shortcodes[0]?.attributes.label).toEqual({
      type: 'string',
      maxLength: 200,
      required: false,
    });
  });

  it('refuses unsafe, inconsistent or unknown manifests', () => {
    const issues = (value: object) =>
      pluginManifestSchema
        .safeParse({ ...base, ...value })
        .error?.issues.map((issue) => issue.path.join('.'));
    expect(issues({ id: 'hello' })).toEqual(['id']);
    expect(issues({ id: 'Acme.Hello' })).toEqual(['id']);
    expect(issues({ version: 'v1' })).toEqual(['version']);
    expect(issues({ apiVersion: 2 })).toEqual(['apiVersion']);
    expect(issues({ main: '../plugin.js' })).toEqual(['main']);
    expect(issues({ main: 'plugin.ts' })).toEqual(['main']);
    expect(issues({ homepage: 'javascript:alert(1)' })).toEqual(['homepage']);
    expect(issues({ permissions: ['db:write'] })).toEqual(['permissions.0']);
    expect(issues({ permissions: ['http:fetch'] })).toEqual(['hosts']);
    expect(issues({ hosts: ['example.com'] })).toEqual(['permissions']);
    expect(issues({ permissions: ['http:fetch'], hosts: ['127.0.0.1'] })).toEqual(['hosts.0']);
    expect(issues({ permissions: ['http:fetch'], hosts: ['*.example.com'] })).toEqual(['hosts.0']);
    expect(issues({ permissions: ['http:fetch'], hosts: ['localhost'] })).toEqual(['hosts.0']);
    expect(issues({ shortcodes: [{ name: 'button', label: 'Mine' }] })).toEqual([
      'shortcodes.0.name',
    ]);
    expect(
      issues({
        shortcodes: [
          { name: 'a', label: 'A' },
          { name: 'a', label: 'B' },
        ],
      }),
    ).toEqual(['shortcodes']);
    expect(issues({ unexpected: true })).toEqual(['']);
    expect(
      issues({ settings: [{ key: 'n', label: 'N', type: 'number', min: 5, max: 1, default: 3 }] }),
    ).toEqual(['settings.0.default']);
    expect(
      issues({
        settings: [
          {
            key: 's',
            label: 'S',
            type: 'select',
            options: [{ value: 'a', label: 'A' }],
            default: 'b',
          },
        ],
      }),
    ).toEqual(['settings.0.default']);
  });
});

describe('plugin settings', () => {
  const definitions: PluginSettingDefinition[] = [
    {
      key: 'label',
      label: 'Label',
      description: '',
      type: 'text',
      maxLength: 20,
      multiline: false,
      default: 'min read',
    },
    {
      key: 'wpm',
      label: 'WPM',
      description: '',
      type: 'number',
      min: 50,
      max: 1000,
      integer: true,
      default: 200,
    },
    { key: 'on', label: 'On', description: '', type: 'boolean', default: true },
    { key: 'token', label: 'Token', description: '', type: 'secret', maxLength: 100 },
  ];

  it('validates partial updates and rejects unknown keys', () => {
    const schema = buildPluginSettingsSchema(definitions);
    expect(schema.parse({ wpm: 250 })).toEqual({ wpm: 250 });
    expect(schema.parse({ token: null })).toEqual({ token: null });
    expect(schema.safeParse({ wpm: 25 }).success).toBe(false);
    expect(schema.safeParse({ wpm: 250.5 }).success).toBe(false);
    expect(schema.safeParse({ label: 'x'.repeat(21) }).success).toBe(false);
    expect(schema.safeParse({ other: 1 }).success).toBe(false);
  });

  it('resolves stored values leniently and masks secrets', () => {
    const values = resolvePluginSettings(definitions, { wpm: 'fast', label: 'mins', token: 'abc' });
    expect(values).toEqual({ label: 'mins', wpm: 200, on: true, token: 'abc' });
    expect(maskPluginSettings(definitions, values)).toEqual({
      label: 'mins',
      wpm: 200,
      on: true,
      token: true,
    });
    expect(resolvePluginSettings(definitions, null).token).toBeNull();
  });
});

describe('plugin shortcode attributes', () => {
  const schema = buildPluginShortcodeAttrsSchema({
    name: 'demo',
    label: 'Demo',
    description: '',
    example: '',
    attributes: {
      count: { type: 'number', min: 1, max: 10, integer: true, required: false, default: 3 },
      title: { type: 'string', maxLength: 10, required: true },
      compact: { type: 'boolean', default: false },
      size: { type: 'enum', values: ['s', 'm'], required: false },
    },
  });

  it('converts and checks raw attribute strings', () => {
    expect(schema.parse({ title: 'Hi' })).toEqual({ title: 'Hi', count: 3, compact: false });
    expect(schema.parse({ title: 'Hi', count: '7', compact: '', size: 'm' })).toEqual({
      title: 'Hi',
      count: 7,
      compact: true,
      size: 'm',
    });
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ title: 'Hi', count: '11' }).success).toBe(false);
    expect(schema.safeParse({ title: 'Hi', count: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ title: 'Hi', compact: 'maybe' }).success).toBe(false);
    expect(schema.safeParse({ title: 'Hi', size: 'xl' }).success).toBe(false);
    expect(schema.safeParse({ title: 'Hi', other: 'x' }).success).toBe(false);
  });
});

describe('plugin output and versions', () => {
  it('accepts text or allowlisted rich text only', () => {
    expect(pluginShortcodeOutputSchema.safeParse('3 min read').success).toBe(true);
    expect(
      pluginShortcodeOutputSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }],
      }).success,
    ).toBe(true);
    expect(
      pluginShortcodeOutputSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(pluginShortcodeOutputSchema.safeParse({ html: '<script>' }).success).toBe(false);
  });

  it('orders semantic versions', () => {
    expect(comparePluginVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(comparePluginVersions('2.0.0', '2.0.0')).toBe(0);
    expect(comparePluginVersions('2.0.0-beta.1', '2.0.0')).toBe(-1);
    expect(comparePluginVersions('2.0.1', '2.0.0')).toBe(1);
  });
});
