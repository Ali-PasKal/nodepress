import {
  API_V1_BASE_PATH,
  apiErrorResponseSchema,
  type ApiErrorCode,
  type ApiErrorIssue,
} from '@nexora/shared';
import type { z } from 'zod';

/** Error codes produced by the client itself, in addition to the API's own codes. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: ClientErrorCode;
  readonly requestId: string | null;
  readonly issues: readonly ApiErrorIssue[];

  constructor(options: {
    status: number | null;
    code: ClientErrorCode;
    message: string;
    requestId?: string | null;
    issues?: readonly ApiErrorIssue[];
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.issues = options.issues ?? [];
  }

  /** 4xx errors will not succeed on retry. */
  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

/**
 * CSRF token for the current session. Held in memory only (never localStorage): it is re-read from
 * `GET /auth/session` after every page load.
 */
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type AuthErrorListener = (error: ApiError) => void;
const authErrorListeners = new Set<AuthErrorListener>();
/** Called when any request fails with 401 (session expired or revoked). */
export function onAuthError(listener: AuthErrorListener): () => void {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  /**
   * HTTP statuses whose body is a valid instance of the response schema. Defaults to [200, 201]. Readiness,
   * for example, returns its normal payload with 503 when the instance is not ready.
   */
  readonly acceptStatuses?: readonly number[];
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request(
  method: Method,
  path: string,
  body: unknown,
  options: ApiRequestOptions,
): Promise<{ response: Response; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(`${API_V1_BASE_PATH}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  const parsed: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { response, body: parsed };
}

function toError(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get('x-request-id');
  const envelope = apiErrorResponseSchema.safeParse(body);
  const error = envelope.success
    ? new ApiError({
        status: response.status,
        code: envelope.data.error.code,
        message: envelope.data.error.message,
        requestId: envelope.data.error.requestId ?? requestId,
        issues: envelope.data.error.issues ?? [],
      })
    : new ApiError({
        status: response.status,
        code: 'INVALID_RESPONSE',
        message: `The API responded with an unexpected status (${String(response.status)}).`,
        requestId,
      });
  if (error.status === 401) {
    for (const listener of authErrorListeners) {
      listener(error);
    }
  }
  return error;
}

function validate<Schema extends z.ZodType>(
  schema: Schema,
  response: Response,
  body: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'The API response did not match the expected format.',
      requestId: response.headers.get('x-request-id'),
    });
  }
  return parsed.data;
}

/**
 * Same-origin API call with runtime response validation. The admin never trusts response shapes blindly:
 * anything that does not match the shared contract becomes an ApiError.
 */
export async function apiGet<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: ApiRequestOptions = {},
): Promise<z.infer<Schema>> {
  const { response, body } = await request('GET', path, undefined, options);
  if (!(options.acceptStatuses ?? [200]).includes(response.status)) {
    throw toError(response, body);
  }
  return validate(schema, response, body);
}

/** State-changing call (adds the CSRF token). Pass `null` as schema for responses without a body. */
export async function apiSend<Schema extends z.ZodType>(
  method: Exclude<Method, 'GET'>,
  path: string,
  payload: unknown,
  schema: Schema,
): Promise<z.infer<Schema>>;
export async function apiSend(
  method: Exclude<Method, 'GET'>,
  path: string,
  payload: unknown,
  schema: null,
): Promise<undefined>;
export async function apiSend<Schema extends z.ZodType>(
  method: Exclude<Method, 'GET'>,
  path: string,
  payload: unknown,
  schema: Schema | null,
): Promise<z.infer<Schema> | undefined> {
  const { response, body } = await request(method, path, payload, {});
  if (!response.ok) {
    throw toError(response, body);
  }
  return schema === null ? undefined : validate(schema, response, body);
}

/**
 * Multipart upload with progress reporting (fetch cannot report upload progress, so this uses XHR).
 * Same CSRF, credential and response-validation rules as `apiSend`.
 */
export function apiUpload<Schema extends z.ZodType>(
  path: string,
  form: FormData,
  schema: Schema,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<z.infer<Schema>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_V1_BASE_PATH}${path}`);
    xhr.withCredentials = false; // same-origin requests send cookies regardless
    xhr.setRequestHeader('Accept', 'application/json');
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('error', () => {
      reject(
        new ApiError({
          status: null,
          code: 'NETWORK_ERROR',
          message: 'The API could not be reached.',
        }),
      );
    });
    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });
    xhr.addEventListener('load', () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      const response = new Response(null, {
        status: xhr.status,
        headers: { 'x-request-id': xhr.getResponseHeader('x-request-id') ?? '' },
      });
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(toError(response, body));
        return;
      }
      try {
        resolve(validate(schema, response, body));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    options.signal?.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(form);
  });
}
