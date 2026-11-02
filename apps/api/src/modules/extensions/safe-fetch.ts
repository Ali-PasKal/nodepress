import { lookup } from 'node:dns/promises';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Outbound HTTPS for plugins (`http:fetch`), with SSRF protection. A plugin never opens a connection itself;
 * the core does it here, and only:
 *
 * - over HTTPS on port 443, to a host the administrator approved (exact name, no wildcards, no IP literals);
 * - after resolving the name and refusing it when *any* address is private, loopback, link-local, multicast,
 *   reserved or otherwise not on the public internet (cloud metadata endpoints included);
 * - connecting to the address that was checked (the lookup is pinned, so a second DNS answer cannot redirect
 *   the connection — no DNS rebinding);
 * - without following redirects (the plugin sees the 3xx), with time, size and header limits.
 */

export class SafeFetchError extends Error {
  override readonly name = 'SafeFetchError';
}

export interface SafeFetchRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface SafeFetchResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface SafeFetchOptions {
  readonly allowedHosts: readonly string[];
  readonly userAgent: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export type Resolver = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

/** How connections are made: HTTPS on port 443 in production; tests substitute a plain local server. */
export interface Transport {
  readonly request: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ReturnType<typeof httpsRequest>;
  readonly protocol: 'https:' | 'http:';
  readonly port: number;
}

const HTTPS: Transport = { request: httpsRequest, protocol: 'https:', port: 443 };

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_BODY = 64 * 1024;
const MAX_HEADERS = 20;
/** Request headers a plugin may not set (connection control, routing, ambient credentials). */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'content-length',
  'cookie',
  'expect',
]);
/** Response headers passed back to the plugin. */
const RESPONSE_HEADERS = ['content-type', 'location', 'etag', 'last-modified', 'retry-after'];

// Separate lists per family: a BlockList also matches IPv4 addresses against IPv6 rules (as IPv4-mapped
// addresses), so the ::ffff:0:0/96 rule would otherwise block every IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked6.addSubnet(network, prefix, 'ipv6');
}

/** Whether an address is on the public internet (anything private, special or reserved is not). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped addresses ("::ffff:10.0.0.1") are judged by their IPv4 part.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    if (mapped?.[1]) return !blocked4.check(mapped[1], 'ipv4');
    return !blocked6.check(address, 'ipv6');
  }
  return false;
}

const systemResolver: Resolver = (hostname) => lookup(hostname, { all: true, order: 'verbatim' });

export class SafeFetch {
  constructor(
    private readonly resolve: Resolver = systemResolver,
    private readonly transport: Transport = HTTPS,
    private readonly allowAddress: (address: string) => boolean = isPublicAddress,
  ) {}

  async fetch(input: SafeFetchRequest, options: SafeFetchOptions): Promise<SafeFetchResponse> {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new SafeFetchError('Invalid URL.');
    }
    if (url.protocol !== 'https:') throw new SafeFetchError('Only https:// addresses are allowed.');
    if (url.username !== '' || url.password !== '') {
      throw new SafeFetchError('Addresses with credentials are not allowed.');
    }
    if (url.port !== '') throw new SafeFetchError('Only the default HTTPS port is allowed.');
    const hostname = url.hostname.toLowerCase();
    if (isIP(hostname.replace(/^\[|\]$/g, '')) !== 0) {
      throw new SafeFetchError('IP addresses are not allowed; use an approved host name.');
    }
    if (!options.allowedHosts.includes(hostname)) {
      throw new SafeFetchError(`The host ${hostname} is not approved for this plugin.`);
    }

    const method = (input.method ?? 'GET').toUpperCase();
    if (!METHODS.has(method)) throw new SafeFetchError(`The method ${method} is not allowed.`);
    const body = input.body ?? '';
    if (Buffer.byteLength(body) > MAX_BODY)
      throw new SafeFetchError('The request body is too large.');
    const headers: Record<string, string> = {};
    const entries = Object.entries(input.headers ?? {});
    if (entries.length > MAX_HEADERS) throw new SafeFetchError('Too many request headers.');
    for (const [name, value] of entries) {
      const key = name.toLowerCase();
      if (
        !/^[a-z0-9-]{1,64}$/.test(key) ||
        FORBIDDEN_HEADERS.has(key) ||
        key.startsWith('proxy-')
      ) {
        throw new SafeFetchError(`The header ${name} is not allowed.`);
      }
      if (typeof value !== 'string' || value.length > 2_000 || /[\r\n]/.test(value)) {
        throw new SafeFetchError(`The header ${name} has an invalid value.`);
      }
      headers[key] = value;
    }
    headers['user-agent'] = options.userAgent;
    if (body !== '') headers['content-length'] = String(Buffer.byteLength(body));

    let addresses: readonly { address: string; family: number }[];
    try {
      addresses = await this.resolve(hostname);
    } catch {
      throw new SafeFetchError(`The host ${hostname} could not be resolved.`);
    }
    if (addresses.length === 0 || addresses.some((entry) => !this.allowAddress(entry.address))) {
      throw new SafeFetchError(`The host ${hostname} resolves to an address that is not allowed.`);
    }
    const pinned = addresses[0];
    if (!pinned) throw new SafeFetchError(`The host ${hostname} could not be resolved.`);
    // Every connection attempt gets the checked address, whatever DNS would answer now.
    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    };

    const timeoutMs = options.timeoutMs ?? 5_000;
    const maxBytes = options.maxResponseBytes ?? 256 * 1024;
    return new Promise<SafeFetchResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        req.destroy(new SafeFetchError('The request timed out.'));
      }, timeoutMs);
      const req = this.transport.request(
        {
          protocol: this.transport.protocol,
          // TLS uses the host name for SNI and certificate verification, the pinned address for the socket.
          hostname,
          port: this.transport.port,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          lookup: pinnedLookup,
          agent: false,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new SafeFetchError('The response is too large.'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            clearTimeout(timer);
            const picked: Record<string, string> = {};
            for (const name of RESPONSE_HEADERS) {
              const value = response.headers[name];
              if (typeof value === 'string') picked[name] = value.slice(0, 2_000);
            }
            resolve({
              status: response.statusCode ?? 0,
              headers: picked,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          response.on('error', (error) => {
            clearTimeout(timer);
            reject(
              error instanceof SafeFetchError ? error : new SafeFetchError('The request failed.'),
            );
          });
        },
      );
      req.on('error', (error) => {
        clearTimeout(timer);
        reject(error instanceof SafeFetchError ? error : new SafeFetchError('The request failed.'));
      });
      if (body !== '') req.write(body);
      req.end();
    });
  }
}
