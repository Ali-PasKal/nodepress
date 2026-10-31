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

export const OWNER_ID = '0192f0a0-0000-7000-8000-000000000001';

export function sessionFixture(
  capabilities: string[] = [
    'dashboard.access',
    'users.read',
    'roles.read',
    'audit.read',
    'system.manage',
  ],
) {
  return {
    authenticated: true as const,
    user: {
      id: OWNER_ID,
      email: 'owner@example.test',
      displayName: 'Site Owner',
      role: {
        id: '0192f0a0-0000-7000-8000-0000000000aa',
        key: 'super_admin',
        name: 'Super Administrator',
      },
    },
    capabilities,
    csrfToken: 'csrf-token-for-tests',
    expiresAt: '2026-11-07T10:00:00.000Z',
  };
}
