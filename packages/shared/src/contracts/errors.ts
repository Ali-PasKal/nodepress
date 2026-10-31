import { z } from 'zod';

/**
 * Stable, machine-readable error codes returned by the API.
 * Clients must branch on `code`, never on the human-readable `message`.
 */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'REQUEST_TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;

/** Uniform error envelope for every non-2xx API response. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(apiErrorIssueSchema).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
