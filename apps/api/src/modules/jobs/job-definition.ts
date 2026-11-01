import type { z } from 'zod';

/** A job type: its name ("area.action") and the schema its payload must satisfy. */
export interface JobType<Payload> {
  readonly name: string;
  readonly schema: z.ZodType<Payload>;
}

export function defineJob<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): JobType<z.output<Schema>> {
  return { name, schema: schema as unknown as z.ZodType<z.output<Schema>> };
}

export interface JobContext {
  readonly jobId: string;
  /** 1 for the first attempt. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Aborted when the job times out or the worker shuts down; long-running handlers should honour it. */
  readonly signal: AbortSignal;
}

export type JobHandler<Payload> = (payload: Payload, context: JobContext) => Promise<void>;

export interface JobHandlerOptions {
  /** Attempts before the job is declared dead (default 5). */
  readonly maxAttempts?: number;
  /** Per-attempt timeout (default 60 s). Must stay below JOBS_LOCK_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Throw from a handler when retrying cannot help (e.g. the referenced record no longer exists). */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';
}

export interface EnqueueOptions {
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  /** At most one job with this key exists at a time; enqueueing a duplicate is a no-op. */
  readonly dedupeKey?: string;
  /** Keep the key after the job finishes (recurring tasks), so the same key can never run twice. */
  readonly keepDedupeKey?: boolean;
}
