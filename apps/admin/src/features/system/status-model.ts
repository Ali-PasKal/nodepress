import type { ComponentStatus, ReadinessResponse, ReadinessStatus } from '@nexora/shared';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export interface OverallStatusView {
  readonly label: string;
  readonly description: string;
  readonly tone: Tone;
}

export interface ComponentView {
  readonly id: 'database' | 'migrations' | 'cache' | 'process';
  readonly name: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly tone: Tone;
  readonly detail: string | null;
}

export function describeOverall(status: ReadinessStatus): OverallStatusView {
  switch (status) {
    case 'ok':
      return {
        label: 'All systems operational',
        description: 'The API is ready to serve requests.',
        tone: 'success',
      };
    case 'degraded':
      return {
        label: 'Degraded performance',
        description: 'The API is serving requests, but an optional service is unavailable.',
        tone: 'warning',
      };
    case 'error':
      return {
        label: 'Service unavailable',
        description: 'A required dependency is unavailable. The API is not ready to serve traffic.',
        tone: 'danger',
      };
  }
}

function componentTone(status: ComponentStatus): Tone {
  if (status === 'up') return 'success';
  if (status === 'down') return 'danger';
  return 'neutral';
}

function componentLabel(status: ComponentStatus): string {
  if (status === 'up') return 'Up';
  if (status === 'down') return 'Down';
  return 'Not configured';
}

function latency(ms: number | undefined): string | null {
  return ms === undefined ? null : `${String(ms)} ms response`;
}

export function describeComponents(checks: ReadinessResponse['checks']): ComponentView[] {
  const { database, migrations, cache, shutdown } = checks;

  let migrationDetail: string | null = null;
  if (migrations.failed !== undefined && migrations.failed > 0) {
    migrationDetail = `${String(migrations.failed)} failed — manual resolution required`;
  } else if (migrations.pending !== undefined && migrations.pending > 0) {
    migrationDetail = `${String(migrations.pending)} pending — run "nexora migrate deploy"`;
  } else if (migrations.status === 'up') {
    migrationDetail = 'Schema is up to date';
  }

  return [
    {
      id: 'database',
      name: 'Database',
      description: 'PostgreSQL primary data store',
      statusLabel: componentLabel(database.status),
      tone: componentTone(database.status),
      detail: database.status === 'up' ? latency(database.latencyMs) : 'Connection failed',
    },
    {
      id: 'migrations',
      name: 'Migrations',
      description: 'Database schema matches this release',
      statusLabel: migrations.status === 'up' ? 'Current' : componentLabel(migrations.status),
      tone: componentTone(migrations.status),
      detail: migrationDetail ?? (migrations.status === 'down' ? 'Status unavailable' : null),
    },
    {
      id: 'cache',
      name: 'Cache',
      description: 'Optional Redis-compatible cache',
      statusLabel: componentLabel(cache.status),
      tone: cache.status === 'down' ? 'warning' : componentTone(cache.status),
      detail:
        cache.status === 'disabled'
          ? 'REDIS_URL is not set; PostgreSQL fallbacks are used'
          : cache.status === 'up'
            ? latency(cache.latencyMs)
            : 'Connection failed',
    },
    {
      id: 'process',
      name: 'API process',
      description: 'Accepting new traffic',
      statusLabel: shutdown.status === 'up' ? 'Running' : 'Shutting down',
      tone: shutdown.status === 'up' ? 'success' : 'warning',
      detail: shutdown.status === 'up' ? null : 'Draining connections before exit',
    },
  ];
}
