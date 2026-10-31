import { z } from 'zod';

/**
 * Public installation status. Intentionally minimal: it reveals whether setup has been completed,
 * which the setup wizard needs before authentication exists, and nothing else (no version numbers).
 */
export const systemStatusResponseSchema = z.object({
  installed: z.boolean(),
});
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
