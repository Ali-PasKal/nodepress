import { describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  readinessResponseSchema,
  systemStatusResponseSchema,
} from '../index.js';

describe('readinessResponseSchema', () => {
  const valid = {
    status: 'ok',
    checkedAt: '2026-10-31T10:00:00.000Z',
    checks: {
      database: { status: 'up', latencyMs: 3 },
      migrations: { status: 'up', pending: 0, failed: 0 },
      cache: { status: 'disabled' },
      shutdown: { status: 'up' },
    },
  };

  it('accepts a well-formed readiness payload', () => {
    expect(readinessResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects unknown component states', () => {
    const invalid = { ...valid, checks: { ...valid.checks, database: { status: 'maybe' } } };
    expect(readinessResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects negative latencies', () => {
    const invalid = {
      ...valid,
      checks: { ...valid.checks, database: { status: 'up', latencyMs: -1 } },
    };
    expect(readinessResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('apiErrorResponseSchema', () => {
  it('requires a known error code', () => {
    expect(
      apiErrorResponseSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Not found' } })
        .success,
    ).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({ error: { code: 'TEAPOT', message: 'nope' } }).success,
    ).toBe(false);
  });
});

describe('systemStatusResponseSchema', () => {
  it('only exposes the installed flag', () => {
    const parsed = systemStatusResponseSchema.parse({ installed: true, version: '1.2.3' });
    expect(parsed).toEqual({ installed: true });
  });
});
