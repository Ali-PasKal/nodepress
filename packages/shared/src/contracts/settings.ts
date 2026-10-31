import { z } from 'zod';
import { baseUrlSchema } from './common.js';

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
