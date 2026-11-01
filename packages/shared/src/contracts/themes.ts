import { z } from 'zod';
import { uuidSchema } from './common.js';

// ---------------------------------------------------------------------------------------------
// Theme manifests and theme settings
//
// A theme is a code package selected by key. Its manifest is plain data: the settings it offers and the
// menu locations it renders. Settings values are validated against the manifest by the API, so a theme
// can rely on receiving values of the declared types (and the defaults for anything missing or stale).
// ---------------------------------------------------------------------------------------------

const settingKey = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/, {
  message: 'Use 1–40 letters or digits in camelCase, starting with a lower-case letter.',
});
const settingLabel = z.string().trim().min(1).max(100);

export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX_COLOR_PATTERN, { message: 'Use a colour like #1d4ed8.' });

const settingBase = z.object({
  key: settingKey,
  label: settingLabel,
  description: z.string().trim().max(300).default(''),
});

const selectOption = z.object({
  value: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(100),
});

export const themeSettingDefinitionSchema = z.discriminatedUnion('type', [
  settingBase.extend({ type: z.literal('color'), default: hexColor }),
  settingBase.extend({
    type: z.literal('select'),
    options: z.array(selectOption).min(1).max(50),
    default: z.string(),
  }),
  settingBase.extend({ type: z.literal('boolean'), default: z.boolean() }),
  settingBase.extend({
    type: z.literal('text'),
    maxLength: z.number().int().min(1).max(1_000).default(200),
    multiline: z.boolean().default(false),
    default: z.string().default(''),
  }),
  /** An image from the media library (stored as its id; delivered resolved). */
  settingBase.extend({ type: z.literal('media') }),
]);
export type ThemeSettingDefinition = z.output<typeof themeSettingDefinitionSchema>;

export const themeMenuLocationSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  label: settingLabel,
});
export type ThemeMenuLocation = z.infer<typeof themeMenuLocationSchema>;

export const THEME_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export const themeManifestSchema = z
  .object({
    key: z.string().regex(THEME_KEY_PATTERN),
    name: z.string().trim().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().trim().max(500).default(''),
    author: z.string().trim().max(100).default(''),
    settings: z.array(themeSettingDefinitionSchema).max(50).default([]),
    menuLocations: z.array(themeMenuLocationSchema).max(10).default([]),
  })
  .superRefine((manifest, ctx) => {
    const keys = new Set<string>();
    manifest.settings.forEach((setting, index) => {
      if (keys.has(setting.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', index, 'key'],
          message: 'Duplicate key.',
        });
      }
      keys.add(setting.key);
      if (
        setting.type === 'select' &&
        !setting.options.some((option) => option.value === setting.default)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['settings', index, 'default'],
          message: 'The default must be one of the options.',
        });
      }
    });
    const locations = new Set<string>();
    manifest.menuLocations.forEach((location, index) => {
      if (locations.has(location.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['menuLocations', index, 'key'],
          message: 'Duplicate key.',
        });
      }
      locations.add(location.key);
    });
  });
export type ThemeManifest = z.output<typeof themeManifestSchema>;
export type ThemeManifestInput = z.input<typeof themeManifestSchema>;

/** A setting value: colours, choices and text are strings, switches booleans, images a media id or null. */
export type ThemeSettingValue = string | boolean | null;
export type ThemeSettingValues = Record<string, ThemeSettingValue>;

export function themeSettingDefault(setting: ThemeSettingDefinition): ThemeSettingValue {
  return setting.type === 'media' ? null : setting.default;
}

/** Validator for one setting's value. */
export function themeSettingValueSchema(
  setting: ThemeSettingDefinition,
): z.ZodType<ThemeSettingValue> {
  switch (setting.type) {
    case 'color':
      return hexColor;
    case 'select': {
      const allowed = new Set(setting.options.map((option) => option.value));
      return z
        .string()
        .refine((value) => allowed.has(value), { message: 'Choose one of the options.' });
    }
    case 'boolean':
      return z.boolean();
    case 'text': {
      const text = z
        .string()
        .trim()
        .max(setting.maxLength, {
          message: `Use at most ${String(setting.maxLength)} characters.`,
        });
      // Single-line text never contains line breaks (they could break out of attributes in some themes).
      return setting.multiline
        ? text
        : text.refine((value) => !/[\r\n]/.test(value), { message: 'Use a single line.' });
    }
    case 'media':
      return uuidSchema.nullable();
  }
}

/**
 * Validator for a complete settings update: every declared key may be given, missing keys take their
 * defaults, unknown keys are rejected.
 */
export function buildThemeSettingsSchema(manifest: ThemeManifest): z.ZodType<ThemeSettingValues> {
  const shape: Record<string, z.ZodType> = {};
  for (const setting of manifest.settings) {
    shape[setting.key] = themeSettingValueSchema(setting).default(
      themeSettingDefault(setting) as never,
    );
  }
  return z.strictObject(shape) as unknown as z.ZodType<ThemeSettingValues>;
}

/**
 * Settings as a theme receives them: stored values that are still valid for the manifest, defaults for
 * everything else (a theme update may have removed an option or changed a type).
 */
export function resolveThemeSettings(manifest: ThemeManifest, stored: unknown): ThemeSettingValues {
  const source =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const values: ThemeSettingValues = {};
  for (const setting of manifest.settings) {
    const parsed = themeSettingValueSchema(setting).safeParse(source[setting.key]);
    values[setting.key] = parsed.success ? parsed.data : themeSettingDefault(setting);
  }
  return values;
}

// ---------------------------------------------------------------------------------------------
// Appearance API
// ---------------------------------------------------------------------------------------------

export const themesResponseSchema = z.object({
  activeTheme: z.string(),
  themes: z.array(themeManifestSchema),
});
export type ThemesResponse = z.infer<typeof themesResponseSchema>;

export const activateThemeSchema = z.object({ theme: z.string().regex(THEME_KEY_PATTERN) });

const themeSettingValueOut = z.union([z.string(), z.boolean(), z.null()]);

export const themeSettingsResponseSchema = z.object({
  theme: z.string(),
  values: z.record(z.string(), themeSettingValueOut),
  /** Previews of the images chosen in media settings, keyed by setting key. */
  media: z.record(
    z.string(),
    z.object({ id: uuidSchema, url: z.string(), thumbnailUrl: z.string(), altText: z.string() }),
  ),
});
export type ThemeSettingsResponse = z.infer<typeof themeSettingsResponseSchema>;

/** Body of a settings update; validated against the theme's manifest by the server. */
export const updateThemeSettingsSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});
export type UpdateThemeSettingsInput = z.input<typeof updateThemeSettingsSchema>;
