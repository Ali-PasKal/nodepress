import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFixture } from '../../test/fixtures';
import { json, mockFetch, renderAdmin } from '../../test/render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const deadJob = {
  id: '0193e0a4-6a5b-7c2d-8e9f-000000000001',
  name: 'mail.send',
  status: 'dead',
  attempts: 8,
  maxAttempts: 8,
  runAt: '2026-11-01T10:00:00.000Z',
  lastError: 'Error: connect ECONNREFUSED',
  createdAt: '2026-11-01T09:00:00.000Z',
  finishedAt: '2026-11-01T10:00:00.000Z',
};

function routes(workers: unknown[]) {
  return {
    '/api/v1/system/status': () => json({ installed: true }),
    '/api/v1/auth/session': () => json(sessionFixture(['dashboard.access', 'jobs.manage'])),
    '/api/v1/jobs/overview': () =>
      json({
        counts: { pending: 0, running: 0, succeeded: 3, dead: 1 },
        oldestDueSeconds: 0,
        workers,
      }),
    '/api/v1/jobs?page=1&pageSize=20': () =>
      json({ items: [deadJob], page: 1, pageSize: 20, total: 1 }),
  };
}

describe('jobs page', () => {
  it('warns when no worker is running and offers retry for failed jobs', async () => {
    mockFetch(routes([]));
    renderAdmin('/system/jobs');
    expect(await screen.findByText('No worker is running')).toBeInTheDocument();
    const row = await screen.findByTestId('job-row');
    expect(within(row).getByText('mail.send')).toBeInTheDocument();
    expect(within(row).getByText('Error: connect ECONNREFUSED')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Retry mail.send' })).toBeInTheDocument();
  });

  it('does not warn while a worker reports in', async () => {
    mockFetch(
      routes([
        {
          id: 'host:1:abc',
          hostname: 'host',
          pid: 1,
          startedAt: '2026-11-01T09:00:00.000Z',
          lastSeenAt: '2026-11-01T10:00:00.000Z',
          active: true,
        },
      ]),
    );
    renderAdmin('/system/jobs');
    expect(await screen.findByTestId('job-row')).toBeInTheDocument();
    expect(screen.queryByText('No worker is running')).toBeNull();
  });
});

describe('command palette', () => {
  it('opens with Ctrl+K, filters commands and navigates', async () => {
    mockFetch({
      ...routes([]),
      '/api/v1/jobs?page=1&pageSize=20': () => json({ items: [], page: 1, pageSize: 20, total: 0 }),
    });
    const { router } = renderAdmin('/system/status');
    await screen.findByRole('button', { name: /Account menu/ });
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', {
      name: 'Search pages, actions and content',
    });
    await userEvent.type(input, 'jobs');
    expect(screen.getByRole('option', { name: 'Background jobs' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/system/jobs');
  });
});
