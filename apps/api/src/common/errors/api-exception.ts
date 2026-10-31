import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorIssue } from '@nexora/shared';

/**
 * An HTTP error whose message is safe to show to clients. Throw this from application code when the
 * client needs a specific, stable error code and message. Any other exception is reported with a
 * generic message so internal details never leak.
 */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    readonly publicMessage: string,
    readonly issues?: readonly ApiErrorIssue[],
  ) {
    super(publicMessage, status);
    this.name = 'ApiException';
  }
}
