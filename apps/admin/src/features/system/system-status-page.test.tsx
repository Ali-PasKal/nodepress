import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { readiness, sessionFixture } from '../../test/fixtures';
import { json, mockFetch, renderAdmin } from '../../test/render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('System status page', () => {
  it('shows a loading state, then live component status from the API', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/health/ready': () => json(readiness()),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/system/status');

    expect(
      await screen.findByRole('heading', { name: 'All systems operational' }),
    ).toBeInTheDocument();

    const database = screen.getByTestId('component-database');
    expect(within(database).getByText('Up')).toBeInTheDocument();
    expect(within(database).getByText('4 ms response')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('component-cache')).getByText('Not configured'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Initial setup has not been completed/)).not.toBeInTheDocument();
    expect(document.title).toBe('System status · NEXORA CMS');
  });

  it('shows a loading state while readiness is being checked', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/health/ready': () => new Promise<Response>(() => undefined),
    });
    renderAdmin('/system/status');
    expect(await screen.findByText('Checking system status…')).toBeInTheDocument();
  });

  it('renders an unready instance from a 503 readiness response', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/health/ready': () =>
        json(
          readiness({
            status: 'error',
            checks: {
              ...readiness().checks,
              migrations: { status: 'down', pending: 1, failed: 0 },
            },
          }),
          503,
        ),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/system/status');

    expect(await screen.findByRole('heading', { name: 'Service unavailable' })).toBeInTheDocument();
    expect(screen.getByText('1 pending — run "nexora migrate deploy"')).toBeInTheDocument();
  });

  it('shows an actionable error when the API is unreachable and recovers on retry', async () => {
    let apiUp = false;
    globalThis.fetch = (input: RequestInfo | URL) => {
      if (!apiUp) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/auth/session')) {
        return Promise.resolve(json(sessionFixture()));
      }
      return Promise.resolve(
        url.endsWith('/health/ready') ? json(readiness()) : json({ installed: true }),
      );
    };

    renderAdmin('/system/status');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Cannot reach the API')).toBeInTheDocument();

    apiUp = true;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'All systems operational' }),
    ).toBeInTheDocument();
  });

  it('shows the request id for API errors so operators can correlate logs', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/health/ready': () =>
        json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'An unexpected error occurred.',
              requestId: 'req-correlate-1',
            },
          },
          500,
        ),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/system/status');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('System status is unavailable')).toBeInTheDocument();
    expect(within(alert).getByText('req-correlate-1')).toBeInTheDocument();
  });

  it('refetches when Refresh is pressed', async () => {
    let calls = 0;
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/health/ready': () => {
        calls += 1;
        return json(readiness());
      },
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/system/status');
    await screen.findByRole('heading', { name: 'All systems operational' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(calls).toBe(2);
    });
  });
});

describe('Routing and layout', () => {
  it('redirects the dashboard root to system status and marks the nav item active', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/health/ready': () => json(readiness()),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'System status' }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'System status' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByText('Status')).toHaveAttribute('aria-current', 'page');
  });

  it('shows a not-found page for unknown routes', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/does/not/exist');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to system status' })).toHaveAttribute(
      'href',
      '/system/status',
    );
  });

  it('provides a skip link to the main content', async () => {
    mockFetch({
      '/api/v1/auth/session': () => json(sessionFixture()),
      '/api/v1/system/status': () => json({ installed: true }),
    });
    renderAdmin('/does/not/exist');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });
});
