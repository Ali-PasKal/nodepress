import { z } from 'zod';

/** Status of a single dependency checked by the readiness probe. */
export const componentStatusSchema = z.enum(['up', 'down', 'disabled']);
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

/**
 * Aggregate readiness:
 * - `ok`: all required dependencies are up.
 * - `degraded`: required dependencies are up, an optional one (e.g. cache) is down.
 * - `error`: a required dependency is down, migrations are pending/failed, or the process is shutting down.
 */
export const readinessStatusSchema = z.enum(['ok', 'degraded', 'error']);
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

const latencyMs = z.number().int().nonnegative();

export const readinessResponseSchema = z.object({
  status: readinessStatusSchema,
  checkedAt: z.iso.datetime(),
  checks: z.object({
    database: z.object({
      status: componentStatusSchema,
      latencyMs: latencyMs.optional(),
    }),
    migrations: z.object({
      status: componentStatusSchema,
      pending: z.number().int().nonnegative().optional(),
      failed: z.number().int().nonnegative().optional(),
    }),
    cache: z.object({
      status: componentStatusSchema,
      latencyMs: latencyMs.optional(),
    }),
    shutdown: z.object({
      status: z.enum(['up', 'down']),
    }),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
