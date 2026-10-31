import { describe, expect, it } from 'vitest';
import { readiness } from '../../test/fixtures';
import { describeComponents, describeOverall } from './status-model';

describe('describeOverall', () => {
  it.each([
    ['ok', 'All systems operational', 'success'],
    ['degraded', 'Degraded performance', 'warning'],
    ['error', 'Service unavailable', 'danger'],
  ] as const)('maps %s', (status, label, tone) => {
    expect(describeOverall(status)).toMatchObject({ label, tone });
  });
});

describe('describeComponents', () => {
  it('describes a healthy instance', () => {
    const views = describeComponents(readiness().checks);
    expect(views.map((view) => [view.id, view.statusLabel, view.tone])).toEqual([
      ['database', 'Up', 'success'],
      ['migrations', 'Current', 'success'],
      ['cache', 'Not configured', 'neutral'],
      ['process', 'Running', 'success'],
    ]);
    expect(views[0]?.detail).toBe('4 ms response');
  });

  it('explains pending and failed migrations', () => {
    const pending = describeComponents({
      ...readiness().checks,
      migrations: { status: 'down', pending: 2, failed: 0 },
    });
    expect(pending[1]?.detail).toBe('2 pending — run "nexora migrate deploy"');

    const failed = describeComponents({
      ...readiness().checks,
      migrations: { status: 'down', pending: 0, failed: 1 },
    });
    expect(failed[1]?.detail).toBe('1 failed — manual resolution required');
  });

  it('treats an unavailable cache as a warning, not an outage', () => {
    const views = describeComponents({ ...readiness().checks, cache: { status: 'down' } });
    expect(views[2]).toMatchObject({
      statusLabel: 'Down',
      tone: 'warning',
      detail: 'Connection failed',
    });
  });

  it('flags a draining process', () => {
    const views = describeComponents({ ...readiness().checks, shutdown: { status: 'down' } });
    expect(views[3]).toMatchObject({ statusLabel: 'Shutting down', tone: 'warning' });
  });
});
