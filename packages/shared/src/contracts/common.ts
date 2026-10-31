import { z } from 'zod';

export const uuidSchema = z.uuid({ message: 'Must be a valid identifier.' });

/** Emails are compared case-insensitively: always trimmed and lower-cased before use. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, { message: 'Email address is too long.' })
  .pipe(z.email({ message: 'Enter a valid email address.' }));

/**
 * Password policy: length is what matters most (NIST SP 800-63B). The upper bound limits hashing cost
 * for hostile input.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.` })
  .max(PASSWORD_MAX_LENGTH, { message: `Use at most ${String(PASSWORD_MAX_LENGTH)} characters.` });

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Name is required.' })
  .max(120, { message: 'Use at most 120 characters.' });

/** http(s) URL without query string or fragment, normalised without a trailing slash. */
export const baseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.search === '' &&
          url.hash === '' &&
          url.username === '' &&
          url.password === ''
        );
      } catch {
        return false;
      }
    },
    { message: 'Enter an http(s) URL without query string, fragment or credentials.' },
  )
  .transform((value) => value.replace(/\/+$/, ''));

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function paginatedSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().nonnegative(),
  });
}

export const isoDateTimeSchema = z.iso.datetime();
