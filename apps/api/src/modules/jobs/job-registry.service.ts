import { Injectable } from '@nestjs/common';
import type { JobHandler, JobHandlerOptions, JobType } from './job-definition.js';

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface RegisteredJob {
  readonly type: JobType<unknown>;
  readonly handle: JobHandler<unknown>;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}

export interface RecurringTask {
  /** Stable identifier; also part of the dedupe key of each run. */
  readonly key: string;
  readonly everyMs: number;
  readonly type: JobType<unknown>;
  readonly payload: unknown;
}

/** Job handlers and recurring tasks, registered by feature modules when they initialise. */
@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<string, RegisteredJob>();
  private readonly tasks = new Map<string, RecurringTask>();

  register<Payload>(
    type: JobType<Payload>,
    handle: JobHandler<Payload>,
    options: JobHandlerOptions = {},
  ): void {
    if (this.handlers.has(type.name)) {
      throw new Error(`Job handler "${type.name}" is already registered`);
    }
    this.handlers.set(type.name, {
      type,
      handle: handle as JobHandler<unknown>,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  get(name: string): RegisteredJob | undefined {
    return this.handlers.get(name);
  }

  /** Runs `type` with `payload` once per `everyMs` slot across all workers. */
  schedule<Payload>(key: string, everyMs: number, type: JobType<Payload>, payload: Payload): void {
    if (this.tasks.has(key)) {
      throw new Error(`Recurring task "${key}" is already registered`);
    }
    this.tasks.set(key, { key, everyMs, type, payload });
  }

  get recurringTasks(): readonly RecurringTask[] {
    return [...this.tasks.values()];
  }
}
