import {
  builderDocumentSchema,
  contentTypeSchema,
  deliveryEntryCardSchema,
  deliveryEntrySchema,
  deliveryPageSchema,
  deliverySiteSchema,
  entryDetailSchema,
  entrySummarySchema,
  jobSummarySchema,
  mediaItemSchema,
  readinessResponseSchema,
  redirectSchema,
  seoSettingsSchema,
  stylesSchema,
  userSummarySchema,
  widgetSchema,
} from '@nexora/shared';
import { z } from 'zod';

/**
 * Titles for the shared contracts that appear in many operations; the OpenAPI document uses them to name the
 * components these schemas are hoisted into (see `shared-schemas.ts`). Documentation only.
 */
export function registerSchemaTitles(): void {
  const titles: [z.ZodType, string][] = [
    [builderDocumentSchema, 'BuilderDocument'],
    [stylesSchema, 'BuilderStyles'],
    ...widgetSchema.options.map((option): [z.ZodType, string] => {
      const type = option.shape.widget.value;
      return [option, `Builder${type.charAt(0).toUpperCase()}${type.slice(1)}Widget`];
    }),
    [contentTypeSchema, 'ContentType'],
    [deliveryEntryCardSchema, 'DeliveryEntryCard'],
    [deliveryEntrySchema, 'DeliveryEntry'],
    [deliveryPageSchema, 'DeliveryPage'],
    [deliverySiteSchema, 'DeliverySite'],
    [entryDetailSchema, 'EntryDetail'],
    [entrySummarySchema, 'EntrySummary'],
    [jobSummarySchema, 'Job'],
    [mediaItemSchema, 'MediaItem'],
    [readinessResponseSchema, 'Readiness'],
    [redirectSchema, 'Redirect'],
    [seoSettingsSchema, 'SeoSettings'],
    [userSummarySchema, 'User'],
  ];
  for (const [schema, title] of titles) {
    if (!z.globalRegistry.has(schema)) z.globalRegistry.add(schema, { title });
  }
}
