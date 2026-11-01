import {
  API_V1_BASE_PATH,
  deliveryFeedSchema,
  deliveryPageSchema,
  deliverySiteSchema,
  deliverySitemapSchema,
  type DeliveryFeed,
  type DeliveryPage,
  type DeliverySite,
  type DeliverySitemap,
} from '@nexora/shared';
import type { z } from 'zod';

/** The Delivery API could not be reached or answered with an error (the site shows a 503 page). */
export class DeliveryUnavailableError extends Error {
  override readonly name: string = 'DeliveryUnavailableError';
}

/** The API is up but NEXORA has not been installed yet (the setup wizard has not been completed). */
export class SiteNotInstalledError extends DeliveryUnavailableError {
  override readonly name = 'SiteNotInstalledError';
}

export interface DeliveryClient {
  page(path: string, page: number): Promise<DeliveryPage>;
  /** Null when the token is invalid or expired. */
  preview(token: string): Promise<DeliveryPage | null>;
  site(): Promise<DeliverySite>;
  sitemap(): Promise<DeliverySitemap>;
  feed(): Promise<DeliveryFeed>;
}

/**
 * HTTP client for the public Delivery API. Responses are validated against the shared contracts, so a
 * mismatched or tampered response is treated as unavailable rather than rendered.
 */
export function createDeliveryClient(baseUrl: string, timeoutMs: number): DeliveryClient {
  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { notFoundAsNull: true },
  ): Promise<T | null>;
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { notFoundAsNull?: boolean } = {},
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${API_V1_BASE_PATH}/delivery${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw new DeliveryUnavailableError('The Delivery API is unreachable.', { cause: error });
    }
    if (response.status === 404 && options.notFoundAsNull) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 409) {
        throw new SiteNotInstalledError('The site has not been set up yet.');
      }
      throw new DeliveryUnavailableError(`The Delivery API answered ${String(response.status)}.`);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new DeliveryUnavailableError('The Delivery API returned an unexpected response.', {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  return {
    page: (path, page) =>
      get(
        `/page?${new URLSearchParams({ path, page: String(page) }).toString()}`,
        deliveryPageSchema,
      ),
    preview: (token) =>
      get(`/preview/${encodeURIComponent(token)}`, deliveryPageSchema, { notFoundAsNull: true }),
    site: () => get('/site', deliverySiteSchema),
    sitemap: () => get('/sitemap', deliverySitemapSchema),
    feed: () => get('/feed', deliveryFeedSchema),
  };
}
