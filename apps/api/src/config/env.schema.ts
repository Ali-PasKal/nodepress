import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppConfig, TrustProxySetting } from './app-config.js';

/**
 * Credentials shipped in `.env.example` / docker-compose for local development. The API refuses to
 * start in production if any of them is still in use.
 */
const KNOWN_DEVELOPMENT_PASSWORDS = new Set([
  'nexora_dev_password',
  'postgres',
  'password',
  'changeme',
]);

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

const booleanFlag = z
  .enum(['true', 'false', '1', '0'], { message: 'must be one of: true, false, 1, 0' })
  .transform((value) => value === 'true' || value === '1');

const integer = (min: number, max: number) =>
  z.coerce
    .number({ message: 'must be a number' })
    .int({ message: 'must be an integer' })
    .min(min, { message: `must be >= ${min}` })
    .max(max, { message: `must be <= ${max}` });

const postgresUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'postgresql:' || url.protocol === 'postgres:') && url.hostname !== ''
      );
    } catch {
      return false;
    }
  },
  { message: 'must be a postgresql:// connection URL' },
);

const redisUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'redis:' || url.protocol === 'rediss:';
    } catch {
      return false;
    }
  },
  { message: 'must be a redis:// or rediss:// URL' },
);

/** A comma-separated list of exact origins (scheme://host[:port]); wildcards are rejected. */
const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .superRefine((origins, ctx) => {
    for (const origin of origins) {
      let normalised: string | null;
      try {
        normalised = new URL(origin).origin;
      } catch {
        normalised = null;
      }
      // URL parsing accepts "*" in hostnames, so wildcards must be rejected explicitly: CORS matching is
      // exact, and a wildcard entry would silently match nothing while looking like it allows subdomains.
      if (
        origin.includes('*') ||
        normalised === null ||
        normalised === 'null' ||
        normalised !== origin.replace(/\/$/, '')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `"${origin}" is not an exact origin (expected scheme://host[:port], no path or wildcard)`,
        });
      }
    }
  })
  .transform((origins) => origins.map((origin) => new URL(origin).origin));

/**
 * Express `trust proxy`. `true` (trust every hop) is deliberately not accepted because it lets any
 * client spoof its address through X-Forwarded-For, which would defeat IP-based rate limiting.
 */
const trustProxy = z.string().transform((value, ctx): TrustProxySetting => {
  const trimmed = value.trim();
  if (trimmed === 'false' || trimmed === '0' || trimmed === '') {
    return false;
  }
  if (trimmed === 'true') {
    ctx.addIssue({
      code: 'custom',
      message:
        'must be "false", a hop count, or a comma-separated list of proxy addresses/subnets; "true" is unsafe',
    });
    return z.NEVER;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: integer(1, 65_535).default(3000),
    TRUST_PROXY: trustProxy.default(false),
    TRUST_REQUEST_ID_HEADER: booleanFlag.default(false),
    CORS_ALLOWED_ORIGINS: originList.default([]),
    REQUEST_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, { message: 'must look like 512kb or 1mb' })
      .default('1mb'),
    REQUEST_TIMEOUT_MS: integer(1_000, 300_000).default(30_000),
    SHUTDOWN_DELAY_MS: integer(0, 60_000).default(0),

    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: integer(1, 200).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: integer(100, 600_000).default(15_000),

    REDIS_URL: redisUrl.optional(),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

    OPENAPI_ENABLED: booleanFlag.optional(),

    HEALTH_CHECK_TIMEOUT_MS: integer(100, 30_000).default(2_000),

    // Sessions: Secure cookies default on in production (and are required there).
    SESSION_COOKIE_SECURE: booleanFlag.optional(),
    SESSION_IDLE_TIMEOUT_MINUTES: integer(5, 60 * 24 * 30).default(60 * 24),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: integer(1, 24 * 90).default(24 * 7),

    // One-time token for the setup wizard. When unset, a random token is generated and logged at startup.
    SETUP_TOKEN: z
      .string()
      .min(24, { message: 'must be at least 24 characters' })
      .max(256)
      .optional(),

    // Mail delivery. "log" and "file" are development transports; SMTP arrives with the job queue (M3).
    MAIL_TRANSPORT: z.enum(['log', 'file', 'disabled']).optional(),
    MAIL_FILE_DIR: z.string().min(1).default(join(tmpdir(), 'nexora-mail')),
    MAIL_FROM: z.string().min(3).max(320).default('NEXORA CMS <no-reply@localhost>'),
    PRISMA_MIGRATIONS_DIR: z.string().min(1).default(DEFAULT_MIGRATIONS_DIR),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    // Production safety rules: refuse configurations that are only acceptable for local development.
    if (env.LOG_FORMAT === 'pretty') {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_FORMAT'],
        message: 'must be "json" in production',
      });
    }
    const dbPassword = safeDecode(new URL(env.DATABASE_URL).password);
    if (dbPassword === '' || KNOWN_DEVELOPMENT_PASSWORDS.has(dbPassword)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          'uses an empty or well-known development password; set a strong unique password in production',
      });
    }
    if (env.SESSION_COOKIE_SECURE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true in production (serve the application over HTTPS)',
      });
    }
    if (env.MAIL_TRANSPORT === 'log' || env.MAIL_TRANSPORT === 'file') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: `"${env.MAIL_TRANSPORT}" writes message contents (including reset links) to disk or logs; not allowed in production`,
      });
    }
    for (const origin of env.CORS_ALLOWED_ORIGINS) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ALLOWED_ORIGINS'],
          message: `"${origin}" must use https in production`,
        });
      }
    }
  });

export type RawEnv = Readonly<Record<string, string | undefined>>;

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Parses and validates environment variables into a typed, frozen configuration object.
 * Error messages name the offending variable but never echo its value (values may be secrets).
 */
export function loadConfig(rawEnv: RawEnv): AppConfig {
  // Treat empty strings as "unset" so `FOO=` in an env file falls back to the default.
  const env = Object.fromEntries(
    Object.entries(rawEnv).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => {
        const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        const topLevelKey = issue.path[0];
        const missing =
          issue.code === 'invalid_type' &&
          typeof topLevelKey === 'string' &&
          env[topLevelKey] === undefined;
        return `${key}: ${missing ? 'is required' : issue.message}`;
      }),
    );
  }
  const parsed = result.data;

  const config: AppConfig = {
    env: parsed.NODE_ENV,
    http: {
      host: parsed.HOST,
      port: parsed.PORT,
      trustProxy: parsed.TRUST_PROXY,
      trustRequestIdHeader: parsed.TRUST_REQUEST_ID_HEADER,
      corsAllowedOrigins: parsed.CORS_ALLOWED_ORIGINS,
      bodyLimit: parsed.REQUEST_BODY_LIMIT.toLowerCase(),
      requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
      shutdownDelayMs: parsed.SHUTDOWN_DELAY_MS,
    },
    database: {
      url: parsed.DATABASE_URL,
      poolMax: parsed.DATABASE_POOL_MAX,
      connectTimeoutMs: parsed.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
      migrationsDir: parsed.PRISMA_MIGRATIONS_DIR,
    },
    cache: {
      redisUrl: parsed.REDIS_URL ?? null,
    },
    logging: {
      level: parsed.LOG_LEVEL,
      format: parsed.LOG_FORMAT,
    },
    openapi: {
      // Interactive API docs are on by default outside production and opt-in in production.
      enabled: parsed.OPENAPI_ENABLED ?? parsed.NODE_ENV !== 'production',
    },
    health: {
      checkTimeoutMs: parsed.HEALTH_CHECK_TIMEOUT_MS,
    },
    session: {
      cookieSecure: parsed.SESSION_COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
      idleTimeoutMs: parsed.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
      absoluteTimeoutMs: parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000,
    },
    setup: {
      token: parsed.SETUP_TOKEN ?? null,
    },
    mail: {
      transport: parsed.MAIL_TRANSPORT ?? (parsed.NODE_ENV === 'production' ? 'disabled' : 'log'),
      fileDir: parsed.MAIL_FILE_DIR,
      from: parsed.MAIL_FROM,
    },
  };
  return deepFreeze(config);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return Object.freeze(value);
}
