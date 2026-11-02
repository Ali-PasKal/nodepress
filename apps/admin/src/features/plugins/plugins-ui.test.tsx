import type { PluginDetail, PluginsResponse, PluginSummary } from '@nexora/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { visibleNavigation } from '../../layouts/navigation';
import { sessionFixture } from '../../test/fixtures';
import { json, renderAdmin } from '../../test/render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const summary = (overrides: Partial<PluginSummary> = {}): PluginSummary => ({
  id: 'nexora.related-posts',
  name: 'Related posts',
  version: '1.0.0',
  description: 'Lists related entries.',
  author: 'NEXORA',
  homepage: null,
  license: 'MIT',
  source: 'bundled',
  status: 'inactive',
  permissions: ['content:read'],
  hosts: [],
  grantedPermissions: [],
  grantedHosts: [],
  needsApproval: true,
  shortcodes: ['related_posts'],
  hooks: [],
  hasSettings: false,
  error: null,
  installedAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  activatedAt: null,
  ...overrides,
});

const notifications: PluginDetail = {
  ...summary({
    id: 'nexora.publish-notifications',
    name: 'Publish notifications',
    permissions: ['http:fetch'],
    hosts: ['hooks.slack.com', 'discord.com'],
    grantedPermissions: ['http:fetch'],
    grantedHosts: ['hooks.slack.com', 'discord.com'],
    needsApproval: false,
    status: 'active',
    shortcodes: [],
    hooks: ['entry.published'],
    hasSettings: true,
  }),
  readme: '# Publish notifications\n<script>alert(1)</script>',
  settingDefinitions: [
    {
      key: 'service',
      label: 'Service',
      description: '',
      type: 'select',
      options: [
        { value: 'slack', label: 'Slack' },
        { value: 'discord', label: 'Discord' },
      ],
      default: 'slack',
    },
    { key: 'webhookUrl', label: 'Webhook URL', description: '', type: 'secret', maxLength: 500 },
    {
      key: 'message',
      label: 'Message',
      description: '',
      type: 'text',
      maxLength: 500,
      multiline: false,
      default: 'New: {title}',
    },
  ],
  settings: { service: 'slack', webhookUrl: true, message: 'New: {title}' },
  shortcodeDefinitions: [],
};

const LIST: PluginsResponse = {
  plugins: [
    summary(),
    summary({
      id: 'acme.broken',
      name: 'Broken',
      status: 'failed',
      error: 'Stopped after 3 crashes.',
      source: 'upload',
      needsApproval: false,
      permissions: [],
    }),
  ],
  bundled: [
    {
      id: 'nexora.reading-time',
      name: 'Reading time',
      version: '1.0.0',
      description: 'Reading time.',
      author: 'NEXORA',
      permissions: [],
      hosts: [],
      installedVersion: null,
    },
  ],
};

interface Request {
  method: string;
  url: string;
  body: unknown;
}

function stub(capabilities: string[]): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url, body });
    if (url === '/api/v1/system/status') return json({ installed: true });
    if (url === '/api/v1/auth/session') return json(sessionFixture(capabilities));
    if (url === '/api/v1/content-model') return json({ contentTypes: [], taxonomies: [] });
    if (url === '/api/v1/plugins') return json(LIST);
    if (url === '/api/v1/plugins/bundled/nexora.reading-time' && method === 'POST') {
      return json(
        { ...notifications, id: 'nexora.reading-time', name: 'Reading time', status: 'inactive' },
        201,
      );
    }
    if (url === '/api/v1/plugins/nexora.related-posts/activate' && method === 'POST') {
      return json(
        { ...notifications, ...summary({ status: 'active', needsApproval: false }) },
        201,
      );
    }
    if (url === '/api/v1/plugins/nexora.publish-notifications') {
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json(notifications);
    }
    if (url === '/api/v1/plugins/nexora.publish-notifications/logs') {
      return json({
        items: [
          {
            id: '1',
            level: 'error',
            message: 'The webhook answered 500.',
            createdAt: '2026-11-01T10:00:00.000Z',
          },
        ],
      });
    }
    if (url === '/api/v1/plugins/nexora.publish-notifications/settings' && method === 'PUT') {
      const values = body as Record<string, unknown>;
      if (values.message === '') {
        return json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Some settings are invalid.',
              requestId: 'r',
              issues: [{ path: 'message', message: 'Too short.' }],
            },
          },
          422,
        );
      }
      return json(notifications);
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
  return requests;
}

const ADMIN = ['dashboard.access', 'plugins.manage'];

describe('plugins page', () => {
  it('lists installed plugins with their state and installs bundled ones', async () => {
    const requests = stub(ADMIN);
    const user = userEvent.setup();
    renderAdmin('/plugins');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plugins' })).toBeInTheDocument();
    const installed = await screen.findByRole('region', { name: 'Installed' });
    expect(within(installed).getByRole('link', { name: 'Related posts' })).toHaveAttribute(
      'href',
      '/plugins/nexora.related-posts',
    );
    expect(within(installed).getByText('Failed')).toBeInTheDocument();
    expect(within(installed).getByText('Stopped after 3 crashes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install Reading time' }));
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === 'POST' && request.url.endsWith('/bundled/nexora.reading-time'),
        ),
      ).toBe(true);
    });
  });

  it('asks the administrator to grant exactly the requested permissions', async () => {
    const requests = stub(ADMIN);
    const user = userEvent.setup();
    renderAdmin('/plugins');
    await user.click(await screen.findByRole('button', { name: 'Review and activate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activate Related posts?' });
    expect(within(dialog).getByText('Read published content')).toBeInTheDocument();
    expect(within(dialog).getByText(/run in an isolated sandbox/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Grant and activate' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const activation = requests.find((request) => request.url.endsWith('/activate'));
    expect(activation?.body).toEqual({ permissions: ['content:read'], hosts: [] });
  });

  it('is only in the navigation for plugins.manage holders', () => {
    const labels = (capabilities: string[]) =>
      visibleNavigation(new Set(capabilities)).flatMap((group) =>
        group.items.map((item) => item.label),
      );
    expect(labels(['dashboard.access'])).not.toContain('Plugins');
    expect(labels(['dashboard.access', 'plugins.manage'])).toContain('Plugins');
  });
});

describe('plugin detail page', () => {
  it('shows permissions, logs and a README as plain text, and keeps secrets unless replaced', async () => {
    const requests = stub(ADMIN);
    const user = userEvent.setup();
    const { container } = renderAdmin('/plugins/nexora.publish-notifications');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Publish notifications' }),
    ).toBeInTheDocument();
    expect(screen.getByText('hooks.slack.com')).toBeInTheDocument();
    expect(await screen.findByText('The webhook answered 500.')).toBeInTheDocument();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();

    const form = screen.getByRole('form', { name: 'Plugin settings' });
    expect(within(form).getByText(/A value is saved/)).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Service'), 'discord');
    await user.click(within(form).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => {
      expect(requests.some((request) => request.method === 'PUT')).toBe(true);
    });
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      service: 'discord',
      message: 'New: {title}',
    });

    await user.type(
      within(form).getByLabelText('Webhook URL'),
      'https://hooks.slack.com/services/new',
    );
    await user.clear(within(form).getByLabelText('Message'));
    await user.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect(await within(form).findByText('Too short.')).toBeInTheDocument();
    const last = requests.filter((request) => request.method === 'PUT').at(-1);
    expect(last?.body).toMatchObject({ webhookUrl: 'https://hooks.slack.com/services/new' });
  });
});
