import type { ReadinessResponse } from '@nexora/shared';

export function readiness(overrides: Partial<ReadinessResponse> = {}): ReadinessResponse {
  return {
    status: 'ok',
    checkedAt: '2026-10-31T10:15:30.000Z',
    checks: {
      database: { status: 'up', latencyMs: 4 },
      migrations: { status: 'up', pending: 0, failed: 0 },
      cache: { status: 'disabled' },
      shutdown: { status: 'up' },
    },
    ...overrides,
  };
}
