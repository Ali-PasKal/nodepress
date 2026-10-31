import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorResponse } from '@nexora/shared';
import { ApiException } from './api-exception.js';

const CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const DEFAULT_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  BAD_REQUEST: 'The request could not be processed.',
  VALIDATION_FAILED: 'The request contains invalid data.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  METHOD_NOT_ALLOWED: 'This method is not allowed for the requested resource.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  PAYLOAD_TOO_LARGE: 'The request body exceeds the maximum allowed size.',
  UNSUPPORTED_MEDIA_TYPE: 'The request content type is not supported.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  REQUEST_TIMEOUT: 'The request took too long to process.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

export interface MappedError {
  readonly status: number;
  readonly body: ApiErrorResponse;
  /** Whether the failure is a server-side fault that must be logged with its cause. */
  readonly isServerError: boolean;
}

export function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

/**
 * Maps any thrown value to the public error envelope. Only `ApiException` messages are passed through;
 * everything else gets a generic message for its status so stack traces, SQL, file paths and
 * framework internals never reach clients.
 */
export function mapError(error: unknown, requestId: string | undefined): MappedError {
  const withId = (
    code: ApiErrorCode,
    message: string,
    extra: Partial<ApiErrorResponse['error']> = {},
  ) => ({
    error: { code, message, ...(requestId === undefined ? {} : { requestId }), ...extra },
  });

  if (error instanceof ApiException) {
    const status = error.getStatus();
    return {
      status,
      isServerError: status >= 500,
      body: withId(
        error.code,
        error.publicMessage,
        error.issues ? { issues: [...error.issues] } : {},
      ),
    };
  }

  // Nest's Express adapter already converts body-parser / http-errors failures (invalid JSON, payload
  // too large) into HttpExceptions before they reach filters, so they are handled here too.
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = codeForStatus(status);
    return { status, isServerError: status >= 500, body: withId(code, DEFAULT_MESSAGES[code]) };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    isServerError: true,
    body: withId('INTERNAL_ERROR', DEFAULT_MESSAGES.INTERNAL_ERROR),
  };
}
