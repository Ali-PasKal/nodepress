import { API_V1_BASE_PATH, apiErrorResponseSchema, type ApiErrorCode } from '@nexora/shared';
import type { z } from 'zod';

/** Error codes produced by the client itself, in addition to the API's own codes. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: ClientErrorCode;
  readonly requestId: string | null;

  constructor(options: {
    status: number | null;
    code: ClientErrorCode;
    message: string;
    requestId?: string | null;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
  }

  /** 4xx errors will not succeed on retry. */
  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  /**
   * HTTP statuses whose body is a valid instance of the response schema. Defaults to [200]. Readiness,
   * for example, returns its normal payload with 503 when the instance is not ready.
   */
  readonly acceptStatuses?: readonly number[];
}

/**
 * Fetches a same-origin API resource and validates the response at runtime. The admin never trusts
 * response shapes blindly: anything that does not match the shared contract becomes an ApiError.
 */
export async function apiGet<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: ApiRequestOptions = {},
): Promise<z.infer<Schema>> {
  const acceptStatuses = options.acceptStatuses ?? [200];
  let response: Response;
  try {
    response = await fetch(`${API_V1_BASE_PATH}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError({
      status: null,
      code: 'NETWORK_ERROR',
      message: 'The API could not be reached.',
    });
  }

  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => undefined);

  if (!acceptStatuses.includes(response.status)) {
    const envelope = apiErrorResponseSchema.safeParse(body);
    if (envelope.success) {
      throw new ApiError({
        status: response.status,
        code: envelope.data.error.code,
        message: envelope.data.error.message,
        requestId: envelope.data.error.requestId ?? requestId,
      });
    }
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: `The API responded with an unexpected status (${response.status}).`,
      requestId,
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'The API response did not match the expected format.',
      requestId,
    });
  }
  return parsed.data;
}
