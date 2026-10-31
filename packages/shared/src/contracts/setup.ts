import { z } from 'zod';
import { baseUrlSchema, displayNameSchema, emailSchema, newPasswordSchema } from './common.js';
import { componentStatusSchema } from './health.js';

export const setupStatusResponseSchema = z.discriminatedUnion('installed', [
  z.object({ installed: z.literal(true) }),
  z.object({
    installed: z.literal(false),
    checks: z.object({
      database: componentStatusSchema,
      migrations: componentStatusSchema,
    }),
    security: z.object({
      environment: z.enum(['development', 'test', 'production']),
      /** Session cookies carry the Secure attribute (required in production, behind HTTPS). */
      secureCookies: z.boolean(),
      /** The request reached the API over HTTPS (directly or via a trusted proxy). */
      httpsRequest: z.boolean(),
    }),
  }),
]);
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const setupInstallSchema = z.object({
  setupToken: z
    .string()
    .trim()
    .min(16, { message: 'Enter the setup token from the server log.' })
    .max(256),
  site: z.object({
    name: z.string().trim().min(1, { message: 'Site name is required.' }).max(200),
    baseUrl: baseUrlSchema,
  }),
  admin: z.object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
  }),
});
export type SetupInstallRequest = z.input<typeof setupInstallSchema>;
