import { readinessResponseSchema, systemStatusResponseSchema } from '@nexora/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch } from '../test/render';
import { readiness } from '../test/fixtures';
import { ApiError, apiGet } from './api-client';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiGet', () => {
  it('requests same-origin versioned URLs and returns validated data', async () => {
    const calls = mockFetch({ '/api/v1/system/status': () => json({ installed: true }) });
    await expect(apiGet('/system/status', systemStatusResponseSchema)).resolves.toEqual({
      installed: true,
    });
    expect(calls).toEqual(['/api/v1/system/status']);
  });

  it('sends cookies only to the same origin and asks for JSON', async () => {
    const spy = vi.fn(() => Promise.resolve(json({ installed: false })));
    globalThis.fetch = spy;
    await apiGet('/system/status', systemStatusResponseSchema);
    expect(spy).toHaveBeenCalledWith('/api/v1/system/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  });

  it('treats explicitly accepted non-2xx statuses as data', async () => {
    const body = readiness({
      status: 'error',
      checks: { ...readiness().checks, database: { status: 'down' } },
    });
    mockFetch({ '/api/v1/health/ready': () => json(body, 503) });
    await expect(
      apiGet('/health/ready', readinessResponseSchema, { acceptStatuses: [200, 503] }),
    ).resolves.toEqual(body);
  });

  it('converts the API error envelope into an ApiError', async () => {
    mockFetch({
      '/api/v1/system/status': () =>
        json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'The service is temporarily unavailable.',
              requestId: 'req-42abcdef',
            },
          },
          503,
        ),
    });
    const error = await apiGet('/system/status', systemStatusResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      requestId: 'req-42abcdef',
    });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const error = await apiGet('/system/status', systemStatusResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });

  it('rejects responses that do not match the contract', async () => {
    mockFetch({
      '/api/v1/system/status': () =>
        json({ installed: 'yes' }, 200, { 'x-request-id': 'req-xyz12345' }),
    });
    const error = await apiGet('/system/status', systemStatusResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
      requestId: 'req-xyz12345',
    });
  });

  it('handles non-JSON error bodies (e.g. a proxy error page)', async () => {
    mockFetch({
      '/api/v1/system/status': () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    });
    const error = await apiGet('/system/status', systemStatusResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
    expect((error as ApiError).isClientError).toBe(false);
  });
});
