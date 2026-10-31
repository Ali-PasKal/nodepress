import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFixture } from '../../test/fixtures';
import { json, mockFetch, renderAdmin } from '../../test/render';
import { safeNextPath } from './session';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('route guards', () => {
  it('sends visitors to the setup wizard before installation', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: false }),
      '/api/v1/auth/session': () => json({ authenticated: false }),
      '/api/v1/setup/status': () =>
        json({
          installed: false,
          checks: { database: 'up', migrations: 'up' },
          security: { environment: 'development', secureCookies: false, httpsRequest: false },
        }),
    });
    renderAdmin('/users');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Set up NEXORA' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Database connection')).toBeInTheDocument();
  });

  it('sends signed-out users to sign in, remembering where they were going', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json({ authenticated: false }),
    });
    const { router } = renderAdmin('/users?page=2');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/users?page=2')}`);
  });

  it('hides navigation the user has no capability for', async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json(sessionFixture(['dashboard.access'])),
      '/api/v1/health/ready': () =>
        json({
          status: 'ok',
          checkedAt: '2026-10-31T10:00:00.000Z',
          checks: {
            database: { status: 'up' },
            migrations: { status: 'up', pending: 0, failed: 0 },
            cache: { status: 'disabled' },
            shutdown: { status: 'up' },
          },
        }),
    });
    renderAdmin('/system/status');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'System status' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it("shows access denied for a page outside the user's capabilities", async () => {
    mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json(sessionFixture(['dashboard.access'])),
    });
    renderAdmin('/audit');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});

describe('sign in', () => {
  it('shows the generic error for bad credentials and signs in on success', async () => {
    let attempts = 0;
    const loginBodies: unknown[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/v1/system/status') return json({ installed: true });
      if (url === '/api/v1/auth/session') return json({ authenticated: false });
      if (url === '/api/v1/auth/login') {
        attempts += 1;
        loginBodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        return attempts === 1
          ? json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password.' } }, 401)
          : json(sessionFixture());
      }
      if (url === '/api/v1/health/ready')
        return json({
          status: 'ok',
          checkedAt: '2026-10-31T10:00:00.000Z',
          checks: {
            database: { status: 'up' },
            migrations: { status: 'up', pending: 0, failed: 0 },
            cache: { status: 'disabled' },
            shutdown: { status: 'up' },
          },
        });
      throw new Error(`Unexpected fetch ${url}`);
    };

    const { router } = renderAdmin('/login?next=%2Fsystem%2Fstatus');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'Owner@Example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(loginBodies[0]).toEqual({ email: 'owner@example.test', password: 'wrong' });

    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/system/status');
    });
  });

  it('validates the form before calling the API', async () => {
    const calls = mockFetch({
      '/api/v1/system/status': () => json({ installed: true }),
      '/api/v1/auth/session': () => json({ authenticated: false }),
    });
    renderAdmin('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(calls).not.toContain('/api/v1/auth/login');
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/users', '/users'],
    ['/users?page=2', '/users?page=2'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    [null, '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('sign out', () => {
  it('ends the session and returns to the sign-in page', async () => {
    let loggedOut = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/v1/system/status') return json({ installed: true });
      if (url === '/api/v1/auth/session')
        return json(loggedOut ? { authenticated: false } : sessionFixture());
      if (url === '/api/v1/auth/logout') {
        expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe(
          'csrf-token-for-tests',
        );
        loggedOut = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/v1/health/ready')
        return json({
          status: 'ok',
          checkedAt: '2026-10-31T10:00:00.000Z',
          checks: {
            database: { status: 'up' },
            migrations: { status: 'up', pending: 0, failed: 0 },
            cache: { status: 'disabled' },
            shutdown: { status: 'up' },
          },
        });
      throw new Error(`Unexpected fetch ${url}`);
    };

    const { router } = renderAdmin('/system/status');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
