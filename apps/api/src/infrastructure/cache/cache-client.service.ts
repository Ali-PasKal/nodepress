import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { once } from 'node:events';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/**
 * Optional Redis-compatible connection (Valkey/Redis). The CMS must remain correct without it, so
 * when REDIS_URL is unset `client` is null and callers fall back to PostgreSQL-backed behaviour.
 *
 * Commands fail fast instead of queueing while disconnected (no offline queue, one retry per request),
 * so an unavailable cache adds bounded latency rather than piling up requests.
 */
@Injectable()
export class CacheClient implements OnApplicationShutdown {
  private readonly logger = new Logger(CacheClient.name);
  readonly client: Redis | null;
  private lastErrorCode: string | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const url = config.cache.redisUrl;
    if (url === null) {
      this.client = null;
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: config.health.checkTimeoutMs,
      connectionName: 'nexora-api',
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });
    this.client.on('error', (err: NodeJS.ErrnoException) => {
      // Log each distinct failure once instead of on every reconnect attempt.
      const code = err.code ?? err.name;
      if (code !== this.lastErrorCode) {
        this.lastErrorCode = code;
        this.logger.warn({ err }, 'Cache connection error');
      }
    });
    this.client.on('ready', () => {
      if (this.lastErrorCode !== null) {
        this.logger.log('Cache connection restored');
      }
      this.lastErrorCode = null;
    });
    this.client.connect().catch(() => {
      // Connection failures are reported via the 'error' event and the readiness check.
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Round-trips a PING. Because the offline queue is disabled, a command issued while (re)connecting
   * would fail immediately, so first wait — at most `timeoutMs` — for the connection to become ready.
   */
  async ping(timeoutMs: number): Promise<void> {
    if (this.client === null) {
      throw new Error('Cache is not configured');
    }
    if (this.client.status !== 'ready') {
      // Rejects on the next 'error' event or when the signal aborts, removing its listener either way.
      await once(this.client, 'ready', { signal: AbortSignal.timeout(timeoutMs) });
    }
    await this.client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client === null) {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
