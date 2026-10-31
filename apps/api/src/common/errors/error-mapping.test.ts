import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { apiErrorResponseSchema } from '@nexora/shared';
import { describe, expect, it } from 'vitest';
import { ApiException } from './api-exception.js';
import { mapError } from './error-mapping.js';

describe('mapError', () => {
  it('passes through the public message and issues of an ApiException', () => {
    const mapped = mapError(
      new ApiException(422, 'VALIDATION_FAILED', 'Title is required.', [
        { path: 'title', message: 'Required' },
      ]),
      'req-12345678',
    );
    expect(mapped.status).toBe(422);
    expect(mapped.isServerError).toBe(false);
    expect(mapped.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Title is required.',
        requestId: 'req-12345678',
        issues: [{ path: 'title', message: 'Required' }],
      },
    });
    expect(apiErrorResponseSchema.parse(mapped.body)).toEqual(mapped.body);
  });

  it('replaces framework exception messages with generic ones', () => {
    // Nest's router puts the requested path in the message; it must not be reflected back.
    const mapped = mapError(
      new NotFoundException('Cannot GET /<script>alert(1)</script>'),
      undefined,
    );
    expect(mapped.status).toBe(404);
    expect(mapped.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
  });

  it('maps body-parser failures surfaced by the Express adapter', () => {
    expect(
      mapError(new PayloadTooLargeException('request entity too large'), 'r').body.error.code,
    ).toBe('PAYLOAD_TOO_LARGE');
    expect(mapError(new BadRequestException('Unexpected token } in JSON'), 'r').body.error).toEqual(
      {
        code: 'BAD_REQUEST',
        message: 'The request could not be processed.',
        requestId: 'r',
      },
    );
  });

  it('never exposes details of unexpected errors', () => {
    const mapped = mapError(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
      'req-1',
    );
    expect(mapped.status).toBe(500);
    expect(mapped.isServerError).toBe(true);
    expect(JSON.stringify(mapped.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
    expect(mapped.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'req-1',
    });
  });

  it('treats unknown 5xx HttpExceptions as server errors with generic messages', () => {
    const mapped = mapError(new HttpException('stack trace here', 502), undefined);
    expect(mapped.status).toBe(502);
    expect(mapped.isServerError).toBe(true);
    expect(mapped.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  });
});
