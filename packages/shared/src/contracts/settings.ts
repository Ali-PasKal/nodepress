import { z } from 'zod';
import { baseUrlSchema, uuidSchema } from './common.js';

export const siteSettingsSchema = z.object({
  name: z.string(),
  baseUrl: z.string(),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const updateSiteSettingsSchema = z
  .object({
    name: z.string().trim().min(1, { message: 'Site name is required.' }).max(200).optional(),
    baseUrl: baseUrlSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.baseUrl !== undefined, {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------------------------
// Public site settings (stored in the site's settings document)
// ---------------------------------------------------------------------------------------------

/** BCP 47 language tag, simplified: language, optional script and region ("fa", "fa-IR", "zh-Hant-TW"). */
export const languageTagSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/, {
    message: 'Use a language tag such as "en", "fa" or "pt-BR".',
  });

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo', 'Adlm', 'Rohg']);
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi']);

/** Text direction of a language tag (the script subtag wins over the language). */
export function textDirection(language: string): 'ltr' | 'rtl' {
  const [primary = '', ...rest] = language.split('-');
  const script = rest.find((part) => /^[A-Z][a-z]{3}$/.test(part));
  if (script !== undefined) {
    return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  }
  return RTL_LANGUAGES.has(primary.toLowerCase()) ? 'rtl' : 'ltr';
}

export const homepageSettingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('posts') }),
  z.object({ mode: z.literal('page'), pageId: uuidSchema }),
]);
export type HomepageSetting = z.infer<typeof homepageSettingSchema>;

export const POSTS_PER_PAGE_MAX = 50;

/** Reading settings as stored (defaults fill in missing values). */
export const readingSettingsSchema = z.object({
  tagline: z.string().trim().max(200).default(''),
  language: languageTagSchema.default('en'),
  homepage: homepageSettingSchema.default({ mode: 'posts' }),
  postsPerPage: z.number().int().min(1).max(POSTS_PER_PAGE_MAX).default(10),
});
export type ReadingSettings = z.output<typeof readingSettingsSchema>;

/** General settings edited on the Appearance page: site name plus reading settings. */
export const generalSettingsSchema = readingSettingsSchema.extend({ name: z.string() });
export type GeneralSettings = z.output<typeof generalSettingsSchema>;

export const updateGeneralSettingsSchema = z.object({
  name: z.string().trim().min(1, { message: 'Site name is required.' }).max(200),
  tagline: z.string().trim().max(200),
  language: languageTagSchema,
  homepage: homepageSettingSchema,
  postsPerPage: z.number().int().min(1).max(POSTS_PER_PAGE_MAX),
});
export type UpdateGeneralSettingsInput = z.input<typeof updateGeneralSettingsSchema>;

export const TITLE_TEMPLATE_DEFAULT = '%title% – %site%';

const titleTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => value.includes('%title%'), {
    message: 'The template must contain %title%.',
  });

export const seoSettingsSchema = z.object({
  /** Page titles: "%title%" is the page title, "%site%" the site name. */
  titleTemplate: titleTemplateSchema.default(TITLE_TEMPLATE_DEFAULT),
  defaultDescription: z.string().trim().max(320).default(''),
  /** Social sharing image used when a page has no featured image. */
  defaultImageId: uuidSchema.nullable().default(null),
  /** Off: robots.txt disallows everything and every page is marked noindex. */
  indexing: z.boolean().default(true),
});
export type SeoSettings = z.output<typeof seoSettingsSchema>;

export const updateSeoSettingsSchema = z.object({
  titleTemplate: titleTemplateSchema,
  defaultDescription: z.string().trim().max(320),
  defaultImageId: uuidSchema.nullable(),
  indexing: z.boolean(),
});
export type UpdateSeoSettingsInput = z.input<typeof updateSeoSettingsSchema>;

/** Response of the SEO settings endpoints: the settings plus a preview of the default image. */
export const seoSettingsResponseSchema = seoSettingsSchema.extend({
  defaultImage: z
    .object({ id: uuidSchema, url: z.string(), thumbnailUrl: z.string(), altText: z.string() })
    .nullable(),
});
export type SeoSettingsResponse = z.infer<typeof seoSettingsResponseSchema>;
