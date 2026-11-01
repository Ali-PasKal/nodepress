import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  createDeliveryClient,
  DeliveryUnavailableError,
  SiteNotInstalledError,
} from '../src/delivery-client.js';
import { site } from './fixtures.js';

describe('delivery client', () => {
  let server: Server;
  let baseUrl: string;
  const seen: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      switch (url.pathname) {
        case '/api/v1/delivery/site':
          json(200, site());
          return;
        case '/api/v1/delivery/page':
          json(200, {
            site: site(),
            route: { kind: 'not_found' },
            preview: false,
            echo: url.searchParams.get('path'),
          });
          return;
        case '/api/v1/delivery/sitemap':
          json(200, { unexpected: true });
          return;
        case '/api/v1/delivery/feed':
          json(500, { error: 'boom' });
          return;
        case '/not-installed/api/v1/delivery/site':
          json(409, { error: { code: 'CONFLICT' } });
          return;
        default:
          if (url.pathname.startsWith('/api/v1/delivery/preview/')) {
            json(404, { error: { code: 'NOT_FOUND' } });
            return;
          }
          if (url.pathname === '/slow') return;
          json(404, {});
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );

  it('validates responses against the shared contracts', async () => {
    const client = createDeliveryClient(baseUrl, 2_000);
    expect((await client.site()).name).toBe('Example Site');
    const page = await client.page('/درباره ما', 2);
    expect(page.route.kind).toBe('not_found');
    expect(seen.at(-1)).toBe(
      `/api/v1/delivery/page?path=${encodeURIComponent('/درباره ما').replace(/%20/g, '+')}&page=2`,
    );
    await expect(client.sitemap()).rejects.toBeInstanceOf(DeliveryUnavailableError);
    await expect(client.feed()).rejects.toThrow('The Delivery API answered 500.');
    expect(await client.preview('A'.repeat(43))).toBeNull();
    await expect(
      createDeliveryClient(`${baseUrl}/not-installed`, 2_000).site(),
    ).rejects.toBeInstanceOf(SiteNotInstalledError);
  });

  it('reports an unreachable or slow API as unavailable', async () => {
    const unreachable = createDeliveryClient('http://127.0.0.1:1', 1_000);
    await expect(unreachable.site()).rejects.toBeInstanceOf(DeliveryUnavailableError);
    const slow = createDeliveryClient(`${baseUrl}/slow#`, 200);
    await expect(slow.site()).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it('loads its configuration with safe defaults and rejects invalid values', () => {
    expect(loadConfig({})).toEqual({
      env: 'development',
      host: '127.0.0.1',
      port: 4321,
      deliveryApiUrl: 'http://127.0.0.1:3000',
      apiTimeoutMs: 5_000,
      logLevel: 'info',
    });
    expect(loadConfig({ DELIVERY_API_URL: 'http://api:3000/' }).deliveryApiUrl).toBe(
      'http://api:3000',
    );
    expect(() => loadConfig({ DELIVERY_API_URL: 'file:///etc/passwd' })).toThrow(
      'DELIVERY_API_URL',
    );
    expect(() => loadConfig({ SITE_PORT: '99999' })).toThrow('SITE_PORT');
  });
});
