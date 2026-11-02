import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';
import { richTextDocumentSchema } from './rich-text.js';
import { SHORTCODE_NAMES } from './shortcodes.js';

// ---------------------------------------------------------------------------------------------
// Plugins
//
// A plugin is a package with a manifest (`nexora-plugin.json`) and one JavaScript file that runs in the sandbox
// (QuickJS in a separate process). The manifest is plain data the core validates here; it declares what the
// plugin asks for (permissions, hosts), what it offers (shortcodes, hooks) and its settings. A manifest is not a
// security boundary: the sandbox and the core's checks are.
// ---------------------------------------------------------------------------------------------

/** Version of the plugin API this core implements; manifests declaring a newer one are refused. */
export const PLUGIN_API_VERSION = 1;

export const PLUGIN_MANIFEST_FILE = 'nexora-plugin.json';

/** Reverse-DNS style id such as `acme.reading-time` (at least one dot, so authors namespace their plugins). */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,30}(?:\.[a-z][a-z0-9-]{0,30}){1,3}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAIN_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.m?js$/;
const SHORTCODE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export const pluginIdSchema = z
  .string()
  .max(64)
  .regex(PLUGIN_ID_PATTERN, { message: 'Use a lowercase id with a dot, like acme.reading-time.' });

export const pluginVersionSchema = z
  .string()
  .max(40)
  .regex(SEMVER_PATTERN, { message: 'Use a semantic version like 1.2.0.' });

/** Compares two semantic versions (pre-releases sort before the release). */
export function comparePluginVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const match = SEMVER_PATTERN.exec(version);
    if (!match) throw new Error(`Invalid version ${version}`);
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ?? null,
    };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Permissions and hooks
// ---------------------------------------------------------------------------------------------

/**
 * Permissions an administrator grants explicitly. Settings, a private key–value storage and logging are
 * always available and need no permission.
 */
export const PLUGIN_PERMISSIONS = ['content:read', 'http:fetch'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_PERMISSION_INFO: Record<
  PluginPermission,
  { label: string; description: string }
> = {
  'content:read': {
    label: 'Read published content',
    description:
      'Titles, addresses, excerpts and terms of published entries — the same as visitors can see. No drafts, users or settings.',
  },
  'http:fetch': {
    label: 'Send requests to other websites',
    description:
      'HTTPS requests made by NEXORA on the plugin’s behalf, only to the hosts listed. Private network addresses are always refused.',
  },
};

export const PLUGIN_HOOKS = ['entry.published', 'entry.unpublished'] as const;
export type PluginHook = (typeof PLUGIN_HOOKS)[number];

export const pluginHostSchema = z.string().max(253).regex(HOSTNAME_PATTERN, {
  message: 'Use a host name like hooks.example.com (no IP addresses).',
});

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const settingBase = z.object({
  key: z.string().regex(SETTING_KEY_PATTERN),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
});

export const pluginSettingDefinitionSchema = z.discriminatedUnion('type', [
  settingBase.extend({
    type: z.literal('text'),
    maxLength: z.number().int().min(1).max(2_000).default(200),
    multiline: z.boolean().default(false),
    default: z.string().max(2_000).default(''),
  }),
  settingBase.extend({
    type: z.literal('number'),
    min: z.number().min(-1e9).max(1e9),
    max: z.number().min(-1e9).max(1e9),
    integer: z.boolean().default(true),
    default: z.number().min(-1e9).max(1e9),
  }),
  settingBase.extend({ type: z.literal('boolean'), default: z.boolean().default(false) }),
  settingBase.extend({
    type: z.literal('select'),
    options: z
      .array(
        z.object({
          value: z.string().min(1).max(64),
          label: z.string().trim().min(1).max(100),
        }),
      )
      .min(1)
      .max(50),
    default: z.string(),
  }),
  /** A credential such as a webhook URL or API key: stored, passed to the plugin, never shown again. */
  settingBase.extend({ type: z.literal('secret'), maxLength: z.number().int().min(1).max(2_000) }),
]);
export type PluginSettingDefinition = z.output<typeof pluginSettingDefinitionSchema>;
export type PluginSettingValue = string | number | boolean | null;
export type PluginSettingValues = Record<string, PluginSettingValue>;

function settingValueSchema(setting: PluginSettingDefinition): z.ZodType<PluginSettingValue> {
  switch (setting.type) {
    case 'text':
      return z.string().max(setting.maxLength);
    case 'number': {
      const number = z.number().min(setting.min).max(setting.max);
      return setting.integer ? number.int() : number;
    }
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.enum(setting.options.map((option) => option.value) as [string, ...string[]]);
    case 'secret':
      return z.string().min(1).max(setting.maxLength).nullable();
  }
}

function settingDefault(setting: PluginSettingDefinition): PluginSettingValue {
  return setting.type === 'secret' ? null : setting.default;
}

/**
 * Validator for a settings update. Every key is optional: omitted keys keep their stored value, so secrets do
 * not have to be sent again (send `null` to clear a secret). Unknown keys are rejected.
 */
export function buildPluginSettingsSchema(
  definitions: readonly PluginSettingDefinition[],
): z.ZodType<Partial<PluginSettingValues>> {
  const shape: Record<string, z.ZodType> = {};
  for (const setting of definitions) shape[setting.key] = settingValueSchema(setting).optional();
  return z.strictObject(shape) as unknown as z.ZodType<Partial<PluginSettingValues>>;
}

/** Settings as the plugin receives them: valid stored values, defaults for everything else. */
export function resolvePluginSettings(
  definitions: readonly PluginSettingDefinition[],
  stored: unknown,
): PluginSettingValues {
  const source =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const values: PluginSettingValues = {};
  for (const setting of definitions) {
    const parsed = settingValueSchema(setting).safeParse(source[setting.key]);
    values[setting.key] = parsed.success ? parsed.data : settingDefault(setting);
  }
  return values;
}

/** Settings as the admin shows them: secrets are replaced by whether they are set. */
export function maskPluginSettings(
  definitions: readonly PluginSettingDefinition[],
  values: PluginSettingValues,
): PluginSettingValues {
  const masked: PluginSettingValues = {};
  for (const setting of definitions) {
    const value = values[setting.key] ?? null;
    masked[setting.key] = setting.type === 'secret' ? value !== null && value !== '' : value;
  }
  return masked;
}

// ---------------------------------------------------------------------------------------------
// Shortcodes offered by plugins
// ---------------------------------------------------------------------------------------------

export const pluginShortcodeAttributeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('string'),
    maxLength: z.number().int().min(1).max(500).default(200),
    required: z.boolean().default(false),
    default: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('number'),
    min: z.number().min(-1e9).max(1e9),
    max: z.number().min(-1e9).max(1e9),
    integer: z.boolean().default(true),
    required: z.boolean().default(false),
    default: z.number().optional(),
  }),
  z.object({ type: z.literal('boolean'), default: z.boolean().default(false) }),
  z.object({
    type: z.literal('enum'),
    values: z.array(z.string().min(1).max(64)).min(1).max(50),
    required: z.boolean().default(false),
    default: z.string().optional(),
  }),
]);
export type PluginShortcodeAttribute = z.output<typeof pluginShortcodeAttributeSchema>;

export const pluginShortcodeDefinitionSchema = z.object({
  name: z
    .string()
    .regex(SHORTCODE_NAME_PATTERN, { message: 'Use lowercase letters, digits and underscores.' })
    .refine((name) => !(SHORTCODE_NAMES as readonly string[]).includes(name), {
      message: 'This name belongs to a built-in shortcode.',
    }),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
  example: z.string().max(200).default(''),
  attributes: z
    .record(z.string().regex(ATTRIBUTE_NAME_PATTERN), pluginShortcodeAttributeSchema)
    .refine((attributes) => Object.keys(attributes).length <= 20, {
      message: 'At most 20 attributes.',
    })
    .default({}),
});
export type PluginShortcodeDefinition = z.output<typeof pluginShortcodeDefinitionSchema>;
export type PluginShortcodeAttrs = Record<string, string | number | boolean>;

const BOOLEAN_VALUES: Record<string, boolean> = {
  '': true,
  true: true,
  '1': true,
  yes: true,
  false: false,
  '0': false,
  no: false,
};

function attributeSchema(attribute: PluginShortcodeAttribute): z.ZodType {
  switch (attribute.type) {
    case 'string': {
      const value = z.string().max(attribute.maxLength);
      if (attribute.default !== undefined) return value.default(attribute.default);
      return attribute.required ? value : value.optional();
    }
    case 'number': {
      let number = z.number().min(attribute.min).max(attribute.max);
      if (attribute.integer) number = number.int();
      const value = z
        .string()
        .regex(/^-?\d{1,10}(?:\.\d{1,6})?$/)
        .transform(Number)
        .pipe(number);
      if (attribute.default !== undefined) return value.default(attribute.default);
      return attribute.required ? value : value.optional();
    }
    case 'boolean':
      return z
        .string()
        .refine((value) => value in BOOLEAN_VALUES, { message: 'Use true or false.' })
        .transform((value) => BOOLEAN_VALUES[value] ?? false)
        .default(attribute.default);
    case 'enum': {
      const value = z.enum(attribute.values as [string, ...string[]]);
      if (attribute.default !== undefined) return value.default(attribute.default);
      return attribute.required ? value : value.optional();
    }
  }
}

/** Validator for a plugin shortcode's raw (string) attributes; unknown attributes are rejected. */
export function buildPluginShortcodeAttrsSchema(
  definition: PluginShortcodeDefinition,
): z.ZodType<PluginShortcodeAttrs> {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, attribute] of Object.entries(definition.attributes)) {
    shape[name] = attributeSchema(attribute);
  }
  return z.strictObject(shape) as unknown as z.ZodType<PluginShortcodeAttrs>;
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

function unique<Item>(items: readonly Item[], key: (item: Item) => string = String): boolean {
  return new Set(items.map(key)).size === items.length;
}

export const pluginManifestSchema = z
  .strictObject({
    id: pluginIdSchema,
    name: z.string().trim().min(1).max(80),
    version: pluginVersionSchema,
    description: z.string().trim().max(300).default(''),
    author: z.string().trim().max(100).default(''),
    homepage: z
      .string()
      .max(500)
      .regex(/^https:\/\/[^\s"'<>]+$/, { message: 'Use an https:// address.' })
      .optional(),
    license: z.string().trim().max(40).optional(),
    apiVersion: z
      .number()
      .int()
      .min(1)
      .max(PLUGIN_API_VERSION, {
        message: `This plugin needs a newer NEXORA (plugin API ${String(PLUGIN_API_VERSION)} is supported).`,
      }),
    main: z.string().regex(MAIN_FILE_PATTERN, { message: 'Name a .js file in the package root.' }),
    permissions: z
      .array(z.enum(PLUGIN_PERMISSIONS))
      .max(PLUGIN_PERMISSIONS.length)
      .refine((items) => unique(items), { message: 'Permissions are listed twice.' })
      .default([]),
    hosts: z
      .array(pluginHostSchema)
      .max(10)
      .refine((items) => unique(items), { message: 'Hosts are listed twice.' })
      .default([]),
    settings: z
      .array(pluginSettingDefinitionSchema)
      .max(30)
      .refine((items) => unique(items, (item) => item.key), {
        message: 'Setting keys must be unique.',
      })
      .default([]),
    shortcodes: z
      .array(pluginShortcodeDefinitionSchema)
      .max(20)
      .refine((items) => unique(items, (item) => item.name), {
        message: 'Shortcode names must be unique.',
      })
      .default([]),
    hooks: z
      .array(z.enum(PLUGIN_HOOKS))
      .max(PLUGIN_HOOKS.length)
      .refine((items) => unique(items), { message: 'Hooks are listed twice.' })
      .default([]),
  })
  .superRefine((manifest, context) => {
    const fetches = manifest.permissions.includes('http:fetch');
    if (fetches && manifest.hosts.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['hosts'],
        message: 'List the hosts the plugin may send requests to.',
      });
    }
    if (!fetches && manifest.hosts.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Hosts need the http:fetch permission.',
      });
    }
    manifest.settings.forEach((setting, index) => {
      if (setting.type === 'number') {
        if (
          setting.min > setting.max ||
          setting.default < setting.min ||
          setting.default > setting.max
        ) {
          context.addIssue({
            code: 'custom',
            path: ['settings', index, 'default'],
            message: 'The default must lie between min and max.',
          });
        }
      }
      if (
        setting.type === 'select' &&
        !setting.options.some((option) => option.value === setting.default)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['settings', index, 'default'],
          message: 'The default must be one of the options.',
        });
      }
    });
    manifest.shortcodes.forEach((shortcode, index) => {
      for (const [name, attribute] of Object.entries(shortcode.attributes)) {
        if (attribute.type === 'number' && attribute.min > attribute.max) {
          context.addIssue({
            code: 'custom',
            path: ['shortcodes', index, 'attributes', name],
            message: 'min is larger than max.',
          });
        }
        if (
          attribute.type === 'enum' &&
          attribute.default !== undefined &&
          !attribute.values.includes(attribute.default)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['shortcodes', index, 'attributes', name],
            message: 'The default must be one of the values.',
          });
        }
      }
    });
  });
export type PluginManifest = z.output<typeof pluginManifestSchema>;

// ---------------------------------------------------------------------------------------------
// Data the sandbox exchanges with plugins
// ---------------------------------------------------------------------------------------------

/** The entry a shortcode appears on, as a plugin sees it (public data only). */
export const pluginEntryContextSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  url: z.string(),
  wordCount: z.number().int().nonnegative(),
  terms: z.array(z.object({ taxonomy: z.string(), slug: z.string(), name: z.string() })),
});
export type PluginEntryContext = z.infer<typeof pluginEntryContextSchema>;

/** A published entry as `content:read` returns it. */
export const pluginContentItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  publishedAt: z.string(),
  terms: z.array(z.object({ taxonomy: z.string(), slug: z.string(), name: z.string() })),
});
export type PluginContentItem = z.infer<typeof pluginContentItemSchema>;

export const pluginContentQuerySchema = z.strictObject({
  type: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .optional(),
  /** Entries with any of these terms, written as `taxonomy:slug`. */
  terms: z.array(z.string().max(200)).max(20).optional(),
  exclude: z.array(z.string().max(64)).max(50).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
export type PluginContentQuery = z.input<typeof pluginContentQuerySchema>;

/** Event data delivered to `entry.published` / `entry.unpublished` hooks. */
export const pluginEntryEventSchema = z.object({
  event: z.enum(PLUGIN_HOOKS),
  entry: z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    /** Absolute public URL (built from the site's base URL). */
    url: z.string().nullable(),
    excerpt: z.string(),
    publishedAt: z.string().nullable(),
  }),
  occurredAt: z.string(),
});
export type PluginEntryEvent = z.infer<typeof pluginEntryEventSchema>;

/**
 * What a shortcode handler may return: nothing (`null`), plain text or a rich-text document. Rich text passes
 * the same allowlist as stored content (no HTML, safe URLs only).
 */
export const pluginShortcodeOutputSchema = z.union([
  z.null(),
  z.string().max(10_000),
  richTextDocumentSchema,
]);

// ---------------------------------------------------------------------------------------------
// Management API
// ---------------------------------------------------------------------------------------------

export const PLUGIN_STATUSES = ['inactive', 'active', 'failed'] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const pluginSummarySchema = z.object({
  id: pluginIdSchema,
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  homepage: z.string().nullable(),
  license: z.string().nullable(),
  source: z.enum(['upload', 'bundled']),
  status: z.enum(PLUGIN_STATUSES),
  /** Requested in the manifest. */
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  hosts: z.array(z.string()),
  /** Granted by an administrator (empty until the first activation). */
  grantedPermissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  grantedHosts: z.array(z.string()),
  /** True when the manifest asks for something that has not been granted yet. */
  needsApproval: z.boolean(),
  shortcodes: z.array(z.string()),
  hooks: z.array(z.enum(PLUGIN_HOOKS)),
  hasSettings: z.boolean(),
  error: z.string().nullable(),
  installedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  activatedAt: isoDateTimeSchema.nullable(),
});
export type PluginSummary = z.infer<typeof pluginSummarySchema>;

export const pluginDetailSchema = pluginSummarySchema.extend({
  readme: z.string(),
  settingDefinitions: z.array(pluginSettingDefinitionSchema),
  /** Current values; secrets appear as `true`/`false` (set or not). */
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  shortcodeDefinitions: z.array(pluginShortcodeDefinitionSchema),
});
export type PluginDetail = z.infer<typeof pluginDetailSchema>;

export const bundledPluginSchema = z.object({
  id: pluginIdSchema,
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  hosts: z.array(z.string()),
  installedVersion: z.string().nullable(),
});
export type BundledPlugin = z.infer<typeof bundledPluginSchema>;

export const pluginsResponseSchema = z.object({
  plugins: z.array(pluginSummarySchema),
  bundled: z.array(bundledPluginSchema),
});
export type PluginsResponse = z.infer<typeof pluginsResponseSchema>;

/** The administrator confirms exactly what the manifest asks for (all or nothing). */
export const activatePluginSchema = z.strictObject({
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).max(PLUGIN_PERMISSIONS.length),
  hosts: z.array(pluginHostSchema).max(10),
});
export type ActivatePluginInput = z.infer<typeof activatePluginSchema>;

export const pluginLogSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  createdAt: isoDateTimeSchema,
});
export type PluginLog = z.infer<typeof pluginLogSchema>;
export const pluginLogsResponseSchema = z.object({ items: z.array(pluginLogSchema) });

/** Shortcodes of active plugins, for editors (validation hints and the shortcode reference). */
export const pluginShortcodesResponseSchema = z.object({
  items: z.array(
    pluginShortcodeDefinitionSchema.extend({ pluginId: pluginIdSchema, pluginName: z.string() }),
  ),
});
export type PluginShortcodesResponse = z.infer<typeof pluginShortcodesResponseSchema>;
