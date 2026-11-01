import { z } from 'zod';

/**
 * Custom field definitions (part of a content type) and the runtime validator for the values an entry
 * stores for them. The same code validates in the admin form and in the API.
 */

const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, {
  message: 'Use 1–40 lower-case letters, digits or underscores, starting with a letter.',
});

const baseField = z.object({
  key: fieldKey,
  label: z.string().trim().min(1, { message: 'Label is required.' }).max(100),
  description: z.string().trim().max(300).default(''),
  required: z.boolean().default(false),
});

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'select',
  'url',
  'email',
  'media',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const selectOption = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
});

export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  baseField.extend({
    type: z.literal('text'),
    maxLength: z.number().int().min(1).max(1_000).default(255),
  }),
  baseField.extend({
    type: z.literal('textarea'),
    maxLength: z.number().int().min(1).max(20_000).default(5_000),
  }),
  baseField.extend({
    type: z.literal('number'),
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    integer: z.boolean().default(false),
  }),
  baseField.extend({ type: z.literal('boolean') }),
  baseField.extend({ type: z.literal('date') }),
  baseField.extend({
    type: z.literal('select'),
    options: z
      .array(selectOption)
      .min(1, { message: 'Add at least one option.' })
      .max(100)
      .refine((options) => new Set(options.map((option) => option.value)).size === options.length, {
        message: 'Option values must be unique.',
      }),
  }),
  baseField.extend({ type: z.literal('url') }),
  baseField.extend({ type: z.literal('email') }),
  baseField.extend({ type: z.literal('media') }),
]);
export type FieldDefinition = z.output<typeof fieldDefinitionSchema>;
export type FieldDefinitionInput = z.input<typeof fieldDefinitionSchema>;

export const fieldDefinitionsSchema = z
  .array(fieldDefinitionSchema)
  .max(50, { message: 'A content type can have at most 50 fields.' })
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: 'Field keys must be unique.',
        });
      }
      seen.add(field.key);
      if (
        field.type === 'number' &&
        field.min !== null &&
        field.max !== null &&
        field.min > field.max
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'max'],
          message: 'Maximum is below minimum.',
        });
      }
    });
  });

export type FieldValue = string | number | boolean | null;
export type FieldValues = Record<string, FieldValue>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a date like 2026-12-31.' });

function valueSchema(field: FieldDefinition): z.ZodType<FieldValue> {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      const text = z
        .string()
        .max(field.maxLength, { message: `Use at most ${String(field.maxLength)} characters.` });
      return field.required ? text.trim().min(1, { message: `${field.label} is required.` }) : text;
    }
    case 'number': {
      let number = z.number({ message: 'Enter a number.' }).refine(Number.isFinite);
      if (field.integer)
        number = number.refine(Number.isInteger, { message: 'Enter a whole number.' });
      if (field.min !== null) {
        const min = field.min;
        number = number.refine((value) => value >= min, {
          message: `Must be at least ${String(min)}.`,
        });
      }
      if (field.max !== null) {
        const max = field.max;
        number = number.refine((value) => value <= max, {
          message: `Must be at most ${String(max)}.`,
        });
      }
      return number;
    }
    case 'boolean':
      return z.boolean();
    case 'date':
      return isoDate;
    case 'select': {
      const allowed = new Set(field.options.map((option) => option.value));
      return z
        .string()
        .refine((value) => allowed.has(value), { message: 'Choose one of the options.' });
    }
    case 'url':
      return z
        .string()
        .max(2_048)
        .refine(
          (value) => {
            try {
              const url = new URL(value);
              return url.protocol === 'https:' || url.protocol === 'http:';
            } catch {
              return false;
            }
          },
          { message: 'Enter an http(s) URL.' },
        );
    case 'email':
      return z.email({ message: 'Enter a valid email address.' }).max(320);
    case 'media':
      return z.uuid({ message: 'Choose a file from the media library.' });
  }
}

/**
 * Validator for an entry's field values. Unknown keys (e.g. fields removed from the type) are dropped;
 * optional fields accept null or absence; required fields must be present and non-empty.
 */
export function buildFieldValuesSchema(fields: readonly FieldDefinition[]): z.ZodType<FieldValues> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const schema = valueSchema(field);
    shape[field.key] = field.required
      ? schema
      : z.preprocess((value) => (value === '' ? null : value), schema.nullable().optional());
  }
  return z.object(shape).transform((values) => {
    const result: FieldValues = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== null) result[key] = value as FieldValue;
    }
    return result;
  });
}

/**
 * Slugs: lower-case letters (any script), combining marks and digits, separated by single hyphens.
 * Non-Latin titles keep their script (modern browsers display IRIs; they are percent-encoded on the wire).
 */
export const SLUG_PATTERN =
  /^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+)*$/u;
export const SLUG_MAX_LENGTH = 200;

export const slugSchema = z
  .string()
  .trim()
  .min(1, { message: 'Slug is required.' })
  .max(SLUG_MAX_LENGTH, { message: `Use at most ${String(SLUG_MAX_LENGTH)} characters.` })
  .refine((value) => SLUG_PATTERN.test(value), {
    message: 'Use lower-case letters, digits and single hyphens (no spaces or slashes).',
  });

/** Derives a slug from a title: lower-cased, separators collapsed to single hyphens. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // Truncate by grapheme so combining marks are never split from their base character.
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(slug),
    (part) => part.segment,
  );
  const truncated = graphemes.slice(0, SLUG_MAX_LENGTH).join('').replace(/-+$/, '');
  return SLUG_PATTERN.test(truncated) ? truncated : '';
}
