import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** A background job as shown to operators. Payloads are deliberately not exposed. */
export const jobSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: jobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAt: isoDateTimeSchema,
  lastError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;

export const jobListQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
});
export const jobListResponseSchema = paginatedSchema(jobSummarySchema);
export type JobListResponse = z.infer<typeof jobListResponseSchema>;

export const jobWorkerSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  pid: z.number().int(),
  startedAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  /** Seen within the last 90 seconds. */
  active: z.boolean(),
});
export type JobWorkerInfo = z.infer<typeof jobWorkerSchema>;

export const jobOverviewSchema = z.object({
  counts: z.object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
  }),
  /** How long the oldest due job has been waiting, in seconds (0 when nothing is due). */
  oldestDueSeconds: z.number().int().nonnegative(),
  workers: z.array(jobWorkerSchema),
});
export type JobOverview = z.infer<typeof jobOverviewSchema>;
