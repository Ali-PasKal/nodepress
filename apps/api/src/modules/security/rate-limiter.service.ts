import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CacheClient } from '../../infrastructure/cache/cache-client.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitState {
  readonly allowed: boolean;
  readonly count: number;
  readonly retryAfterSeconds: number;
}

/** Central list of limits so they are reviewed together. */
export const RATE_LIMITS = {
  loginPerIp: { limit: 20, windowMs: 5 * 60_000 },
  loginFailuresPerAccount: { limit: 5, windowMs: 15 * 60_000 },
  passwordResetPerIp: { limit: 5, windowMs: 15 * 60_000 },
  passwordResetPerAccount: { limit: 3, windowMs: 60 * 60_000 },
  passwordResetConfirmPerIp: { limit: 10, windowMs: 15 * 60_000 },
  setupPerIp: { limit: 10, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counters. Uses the Redis-compatible cache when it is connected and falls back to
 * PostgreSQL otherwise (or if the cache errors), so protection never silently disappears.
 * Subjects (IPs, emails) are hashed before use so keys contain no personal data.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheClient,
  ) {}

  /** Counts one hit for `subject` and reports whether it is still within the limit. */
  async hit(scope: string, subject: string, rule: RateLimitRule): Promise<RateLimitState> {
    const { key, expiresAt, retryAfterSeconds } = this.window(scope, subject, rule);
    const count = await this.increment(key, expiresAt);
    return { allowed: count <= rule.limit, count, retryAfterSeconds };
  }

  /** Reads the current window without counting. */
  async peek(scope: string, subject: string, rule: RateLimitRule): Promise<RateLimitState> {
    const { key, retryAfterSeconds } = this.window(scope, subject, rule);
    const count = await this.read(key);
    return { allowed: count < rule.limit, count, retryAfterSeconds };
  }

  /** Clears the current window (e.g. failed-login counter after a successful login). */
  async reset(scope: string, subject: string, rule: RateLimitRule): Promise<void> {
    const { key } = this.window(scope, subject, rule);
    const client = this.readyCache();
    if (client) {
      try {
        await client.del(key);
        return;
      } catch (err) {
        this.logger.warn({ err }, 'Rate limiter cache unavailable; using PostgreSQL');
      }
    }
    await this.prisma.rateLimitBucket.deleteMany({ where: { key } });
  }

  private window(scope: string, subject: string, rule: RateLimitRule) {
    const now = Date.now();
    const index = Math.floor(now / rule.windowMs);
    const windowEnd = (index + 1) * rule.windowMs;
    const digest = createHash('sha256').update(subject.toLowerCase()).digest('hex').slice(0, 32);
    return {
      key: `rl:${scope}:${digest}:${String(index)}`,
      expiresAt: new Date(windowEnd),
      retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
    };
  }

  private readyCache() {
    const client = this.cache.client;
    return client?.status === 'ready' ? client : null;
  }

  private async increment(key: string, expiresAt: Date): Promise<number> {
    const client = this.readyCache();
    if (client) {
      try {
        const results = await client.multi().incr(key).pexpireat(key, expiresAt.getTime()).exec();
        const count = results?.[0]?.[1];
        if (typeof count === 'number') {
          return count;
        }
      } catch (err) {
        this.logger.warn({ err }, 'Rate limiter cache unavailable; using PostgreSQL');
      }
    }
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, count, expires_at) VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT (key) DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count
    `;
    // Opportunistic cleanup keeps the table small without a scheduler (jobs arrive in M3).
    if (Math.random() < 0.02) {
      await this.prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    }
    return rows[0]?.count ?? 1;
  }

  private async read(key: string): Promise<number> {
    const client = this.readyCache();
    if (client) {
      try {
        const value = await client.get(key);
        return value === null ? 0 : Number(value);
      } catch (err) {
        this.logger.warn({ err }, 'Rate limiter cache unavailable; using PostgreSQL');
      }
    }
    const bucket = await this.prisma.rateLimitBucket.findUnique({ where: { key } });
    return bucket?.count ?? 0;
  }
}
