import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPublicAddress, SafeFetch, type Resolver } from './safe-fetch.js';

const options = { allowedHosts: ['hooks.example.com'], userAgent: 'NEXORA-Plugin/test' };

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, metadata and reserved addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '2001:db8::1',
      'not an address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe('SafeFetch', () => {
  const resolver =
    (...addresses: string[]): Resolver =>
    () =>
      Promise.resolve(
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );

  it('refuses before connecting: scheme, credentials, ports, IP literals, unapproved hosts, private DNS answers', async () => {
    const fetcher = new SafeFetch(resolver('93.184.216.34'));
    const refused = async (url: string, resolve?: Resolver) =>
      (resolve ? new SafeFetch(resolve) : fetcher).fetch({ url }, options).then(
        () => 'allowed',
        (error: unknown) => (error as Error).message,
      );
    expect(await refused('http://hooks.example.com/')).toMatch(/Only https/);
    expect(await refused('https://user:pw@hooks.example.com/')).toMatch(/credentials/);
    expect(await refused('https://hooks.example.com:8443/')).toMatch(/default HTTPS port/);
    expect(await refused('https://93.184.216.34/')).toMatch(/IP addresses/);
    expect(await refused('https://[::1]/')).toMatch(/IP addresses/);
    expect(await refused('https://evil.example.com/')).toMatch(/not approved/);
    expect(await refused('https://HOOKS.EXAMPLE.COM.evil.com/')).toMatch(/not approved/);
    expect(await refused('https://hooks.example.com/', resolver('10.0.0.5'))).toMatch(
      /not allowed/,
    );
    expect(await refused('https://hooks.example.com/', resolver('169.254.169.254'))).toMatch(
      /not allowed/,
    );
    // One private answer among public ones is enough to refuse (no mixed-record tricks).
    expect(
      await refused('https://hooks.example.com/', resolver('93.184.216.34', '127.0.0.1')),
    ).toMatch(/not allowed/);
    expect(await refused('https://hooks.example.com/', resolver())).toMatch(/not allowed/);
    await expect(
      fetcher.fetch({ url: 'https://hooks.example.com/', method: 'CONNECT' }, options),
    ).rejects.toThrow(/method CONNECT/);
    await expect(
      fetcher.fetch({ url: 'https://hooks.example.com/', headers: { Cookie: 'a=b' } }, options),
    ).rejects.toThrow(/header Cookie/);
    await expect(
      fetcher.fetch({ url: 'https://hooks.example.com/', headers: { 'X-A': 'a\r\nb' } }, options),
    ).rejects.toThrow(/invalid value/);
    await expect(
      fetcher.fetch({ url: 'https://hooks.example.com/', body: 'x'.repeat(70_000) }, options),
    ).rejects.toThrow(/body is too large/);
  });

  describe('against a local server', () => {
    let server: Server;
    let port: number;
    const seen: {
      method: string | undefined;
      url: string | undefined;
      headers: Record<string, unknown>;
      body: string;
    }[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          seen.push({ method: req.method, url: req.url, headers: req.headers, body });
          if (req.url === '/redirect') {
            res.writeHead(302, { location: 'http://127.0.0.1/admin', 'set-cookie': 'x=1' }).end();
          } else if (req.url === '/huge') {
            res.writeHead(200).end('x'.repeat(300_000));
          } else if (req.url === '/slow') {
            setTimeout(() => res.writeHead(200).end('late'), 2_000);
          } else {
            res
              .writeHead(200, { 'content-type': 'application/json', 'x-secret': 'no' })
              .end('{"ok":true}');
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });

    // The local server is on loopback, so this test explicitly allows that address; the transport is plain
    // HTTP to the test port. Everything else (pinning, headers, limits, no redirects) is the real code path.
    const local = () =>
      new SafeFetch(
        resolver('127.0.0.1'),
        { request: httpRequest, protocol: 'http:', port },
        () => true,
      );

    it('sends the request to the pinned address with sanitised headers and returns a filtered response', async () => {
      const response = await local().fetch(
        {
          url: 'https://hooks.example.com/hook?x=1',
          method: 'post',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
          body: '{"text":"hi"}',
        },
        options,
      );
      expect(response).toEqual({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      });
      const request = seen.at(-1);
      expect(request).toMatchObject({ method: 'POST', url: '/hook?x=1', body: '{"text":"hi"}' });
      expect(request?.headers).toMatchObject({
        // The approved name, not the address (the test server's port appears because it is not 443).
        host: `hooks.example.com:${String(port)}`,
        'user-agent': 'NEXORA-Plugin/test',
        authorization: 'Bearer abc',
      });
    });

    it('does not follow redirects, caps the response size and times out', async () => {
      const redirect = await local().fetch({ url: 'https://hooks.example.com/redirect' }, options);
      expect(redirect).toEqual({
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
        body: '',
      });
      expect(seen.filter((request) => request.url === '/admin')).toHaveLength(0);
      await expect(
        local().fetch({ url: 'https://hooks.example.com/huge' }, options),
      ).rejects.toThrow(/too large/);
      await expect(
        local().fetch({ url: 'https://hooks.example.com/slow' }, { ...options, timeoutMs: 200 }),
      ).rejects.toThrow(/timed out/);
    });
  });
});
