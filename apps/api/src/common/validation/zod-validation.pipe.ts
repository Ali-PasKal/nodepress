import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';

/**
 * Validates and normalises untrusted input (body, query, params) against a shared Zod contract.
 * Invalid input becomes 422 VALIDATION_FAILED with per-field issues; unknown keys are stripped.
 */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        'The request contains invalid data.',
        result.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
