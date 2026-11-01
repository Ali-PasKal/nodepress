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
const DEFAULT_MEDIA_DIR = fileURLToPath(new URL('../../storage/uploads', import.meta.url));

/** http(s) URL used as a prefix; normalised without a trailing slash. */
const urlPrefix = z
  .string()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          url.search === '' &&
          url.hash === ''
        );
      } catch {
        return false;
      }
    },
    { message: 'must be an http(s) URL without query string or fragment' },
  )
  .transform((value) => value.replace(/\/+$/, ''));

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

    // Mail delivery. "log" and "file" are development transports; "smtp" is the production transport.
    MAIL_TRANSPORT: z.enum(['log', 'file', 'smtp', 'disabled']).optional(),
    MAIL_FILE_DIR: z.string().min(1).default(join(tmpdir(), 'nexora-mail')),
    MAIL_FROM: z.string().min(3).max(320).default('NEXORA CMS <no-reply@localhost>'),
    SMTP_HOST: z.string().min(1).max(255).optional(),
    SMTP_PORT: integer(1, 65_535).default(587),
    SMTP_SECURE: booleanFlag.default(false),
    SMTP_REQUIRE_TLS: booleanFlag.default(true),
    SMTP_TLS_REJECT_UNAUTHORIZED: booleanFlag.default(true),
    SMTP_USER: z.string().min(1).max(320).optional(),
    SMTP_PASSWORD: z.string().min(1).max(1024).optional(),

    // Background jobs.
    JOBS_WORKER: z.enum(['embedded', 'off']).default('embedded'),
    JOBS_CONCURRENCY: integer(1, 32).default(2),
    JOBS_POLL_INTERVAL_MS: integer(100, 60_000).default(5_000),
    JOBS_LOCK_TIMEOUT_MS: integer(1_000, 86_400_000).default(900_000),
    JOBS_RETRY_BASE_MS: integer(10, 3_600_000).default(15_000),
    JOBS_SHUTDOWN_GRACE_MS: integer(0, 120_000).default(8_000),

    // Media storage.
    MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_DIR: z.string().min(1).default(DEFAULT_MEDIA_DIR),
    MEDIA_MAX_UPLOAD_MB: integer(1, 512).default(25),
    MEDIA_PUBLIC_BASE_URL: urlPrefix.optional(),
    S3_BUCKET: z.string().min(3).max(63).optional(),
    S3_REGION: z.string().min(1).max(64).default('us-east-1'),
    S3_ENDPOINT: urlPrefix.optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).max(256).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).max(256).optional(),
    S3_FORCE_PATH_STYLE: booleanFlag.default(false),

    // Content.
    CONTENT_TRASH_RETENTION_DAYS: integer(1, 3650).default(30),
    CONTENT_REVISIONS_LIMIT: integer(1, 1000).default(50),
    PRISMA_MIGRATIONS_DIR: z.string().min(1).default(DEFAULT_MIGRATIONS_DIR),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp' && env.SMTP_HOST === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'is required when MAIL_TRANSPORT is "smtp"',
      });
    }
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD must be set together',
      });
    }
    if (env.MEDIA_STORAGE === 's3' && env.S3_BUCKET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'is required when MEDIA_STORAGE is "s3"',
      });
    }
    if ((env.S3_ACCESS_KEY_ID === undefined) !== (env.S3_SECRET_ACCESS_KEY === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
      });
    }
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
    const smtpInUse =
      env.MAIL_TRANSPORT === 'smtp' ||
      (env.MAIL_TRANSPORT === undefined && env.SMTP_HOST !== undefined);
    if (smtpInUse) {
      if (!env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_REQUIRE_TLS'],
          message: 'SMTP must use TLS in production (SMTP_SECURE=true or SMTP_REQUIRE_TLS=true)',
        });
      }
      if (!env.SMTP_TLS_REJECT_UNAUTHORIZED) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_TLS_REJECT_UNAUTHORIZED'],
          message:
            'must be true in production (certificate verification protects credentials and links)',
        });
      }
      if (/@localhost>?$/i.test(env.MAIL_FROM)) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_FROM'],
          message: 'must be a real sender address in production',
        });
      }
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
    mail: buildMailConfig(parsed),
    jobs: {
      worker: parsed.JOBS_WORKER,
      concurrency: parsed.JOBS_CONCURRENCY,
      pollIntervalMs: parsed.JOBS_POLL_INTERVAL_MS,
      lockTimeoutMs: parsed.JOBS_LOCK_TIMEOUT_MS,
      retryBaseMs: parsed.JOBS_RETRY_BASE_MS,
      shutdownGraceMs: parsed.JOBS_SHUTDOWN_GRACE_MS,
    },
    media: {
      storage: parsed.MEDIA_STORAGE,
      localDir: parsed.MEDIA_LOCAL_DIR,
      maxUploadBytes: parsed.MEDIA_MAX_UPLOAD_MB * 1024 * 1024,
      publicBaseUrl: parsed.MEDIA_PUBLIC_BASE_URL ?? null,
      s3:
        parsed.S3_BUCKET === undefined
          ? null
          : {
              bucket: parsed.S3_BUCKET,
              region: parsed.S3_REGION,
              endpoint: parsed.S3_ENDPOINT ?? null,
              accessKeyId: parsed.S3_ACCESS_KEY_ID ?? null,
              secretAccessKey: parsed.S3_SECRET_ACCESS_KEY ?? null,
              forcePathStyle: parsed.S3_FORCE_PATH_STYLE,
            },
    },
    content: {
      trashRetentionDays: parsed.CONTENT_TRASH_RETENTION_DAYS,
      revisionLimit: parsed.CONTENT_REVISIONS_LIMIT,
    },
  };
  return deepFreeze(config);
}

function buildMailConfig(parsed: z.output<typeof envSchema>): AppConfig['mail'] {
  const transport =
    parsed.MAIL_TRANSPORT ??
    (parsed.NODE_ENV === 'production' ? (parsed.SMTP_HOST ? 'smtp' : 'disabled') : 'log');
  return {
    transport,
    fileDir: parsed.MAIL_FILE_DIR,
    from: parsed.MAIL_FROM,
    smtp:
      transport === 'smtp' && parsed.SMTP_HOST !== undefined
        ? {
            host: parsed.SMTP_HOST,
            port: parsed.SMTP_PORT,
            secure: parsed.SMTP_SECURE,
            requireTls: parsed.SMTP_REQUIRE_TLS,
            rejectUnauthorized: parsed.SMTP_TLS_REJECT_UNAUTHORIZED,
            user: parsed.SMTP_USER ?? null,
            password: parsed.SMTP_PASSWORD ?? null,
          }
        : null,
  };
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
