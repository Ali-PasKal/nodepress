import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './env.schema.js';

const DEV_DB = 'postgresql://nexora:nexora_dev_password@localhost:5432/nexora';
const STRONG_DB = 'postgresql://nexora:Zk3%23p9vLq2xW8rT@db.internal:5432/nexora';

function configError(env: Record<string, string>): ConfigValidationError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected configuration to be rejected');
}

describe('loadConfig', () => {
  it('applies safe defaults for a minimal development environment', () => {
    const config = loadConfig({ DATABASE_URL: DEV_DB });
    expect(config.env).toBe('development');
    expect(config.http).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      trustProxy: false,
      trustRequestIdHeader: false,
      corsAllowedOrigins: [],
      bodyLimit: '1mb',
      requestTimeoutMs: 30_000,
    });
    expect(config.cache.redisUrl).toBeNull();
    expect(config.logging).toEqual({ level: 'info', format: 'json' });
    expect(config.openapi.enabled).toBe(true);
  });

  it('requires DATABASE_URL', () => {
    expect(configError({}).issues).toContain('DATABASE_URL: is required');
  });

  it('rejects non-PostgreSQL database URLs', () => {
    const error = configError({ DATABASE_URL: 'mysql://user:pw@localhost/db' });
    expect(error.issues).toContain('DATABASE_URL: must be a postgresql:// connection URL');
  });

  it('never echoes configuration values (which may be secrets) in error messages', () => {
    const secret = 'super-secret-password-value';
    const error = configError({
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://user:${secret}@localhost/db`,
      LOG_FORMAT: 'pretty',
      PORT: secret,
    });
    expect(error.message).not.toContain(secret);
    expect(error.issues).toContain('PORT: must be a number');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ DATABASE_URL: DEV_DB, REDIS_URL: '', PORT: '' });
    expect(config.cache.redisUrl).toBeNull();
    expect(config.http.port).toBe(3000);
  });

  it('validates and normalises CORS origins', () => {
    const config = loadConfig({
      DATABASE_URL: DEV_DB,
      CORS_ALLOWED_ORIGINS: 'https://admin.example.com, http://localhost:5173/',
    });
    expect(config.http.corsAllowedOrigins).toEqual([
      'https://admin.example.com',
      'http://localhost:5173',
    ]);
  });

  it.each(['*', 'https://example.com/path', 'not a url', 'https://*.example.com'])(
    'rejects CORS entry %j',
    (origin) => {
      expect(configError({ DATABASE_URL: DEV_DB, CORS_ALLOWED_ORIGINS: origin }).issues[0]).toMatch(
        /^CORS_ALLOWED_ORIGINS: /,
      );
    },
  );

  it('parses TRUST_PROXY hop counts and address lists but rejects "true"', () => {
    expect(loadConfig({ DATABASE_URL: DEV_DB, TRUST_PROXY: '1' }).http.trustProxy).toBe(1);
    expect(
      loadConfig({ DATABASE_URL: DEV_DB, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).http.trustProxy,
    ).toEqual(['loopback', '10.0.0.0/8']);
    expect(configError({ DATABASE_URL: DEV_DB, TRUST_PROXY: 'true' }).issues[0]).toMatch(
      /^TRUST_PROXY: .*unsafe/,
    );
  });

  it('rejects out-of-range numeric settings', () => {
    expect(configError({ DATABASE_URL: DEV_DB, REQUEST_TIMEOUT_MS: '10' }).issues).toContain(
      'REQUEST_TIMEOUT_MS: must be >= 1000',
    );
    expect(configError({ DATABASE_URL: DEV_DB, PORT: '70000' }).issues).toContain(
      'PORT: must be <= 65535',
    );
  });

  it('returns a deeply frozen object', () => {
    const config = loadConfig({ DATABASE_URL: DEV_DB });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.http)).toBe(true);
    expect(Object.isFrozen(config.http.corsAllowedOrigins)).toBe(true);
  });

  describe('production safety rules', () => {
    it('accepts a hardened production configuration and disables API docs by default', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: STRONG_DB,
        CORS_ALLOWED_ORIGINS: 'https://admin.example.com',
      });
      expect(config.env).toBe('production');
      expect(config.openapi.enabled).toBe(false);
    });

    it('allows API docs in production only when explicitly enabled', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: STRONG_DB,
        OPENAPI_ENABLED: 'true',
      });
      expect(config.openapi.enabled).toBe(true);
    });

    it('rejects well-known development database passwords', () => {
      expect(configError({ NODE_ENV: 'production', DATABASE_URL: DEV_DB }).issues[0]).toMatch(
        /^DATABASE_URL: uses an empty or well-known development password/,
      );
    });

    it('rejects an empty database password', () => {
      expect(
        configError({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://nexora@db:5432/nexora' })
          .issues[0],
      ).toMatch(/^DATABASE_URL: /);
    });

    it('rejects pretty logs and plain-http CORS origins', () => {
      const error = configError({
        NODE_ENV: 'production',
        DATABASE_URL: STRONG_DB,
        LOG_FORMAT: 'pretty',
        CORS_ALLOWED_ORIGINS: 'http://admin.example.com',
      });
      expect(error.issues).toEqual([
        'LOG_FORMAT: must be "json" in production',
        'CORS_ALLOWED_ORIGINS: "http://admin.example.com" must use https in production',
      ]);
    });
  });
});

describe('identity and mail configuration', () => {
  it('defaults to Secure cookies only in production and sensible session lifetimes', () => {
    const dev = loadConfig({ DATABASE_URL: DEV_DB });
    expect(dev.session).toEqual({
      cookieSecure: false,
      idleTimeoutMs: 86_400_000,
      absoluteTimeoutMs: 604_800_000,
    });
    expect(dev.mail.transport).toBe('log');
    const prod = loadConfig({ NODE_ENV: 'production', DATABASE_URL: STRONG_DB });
    expect(prod.session.cookieSecure).toBe(true);
    expect(prod.mail.transport).toBe('disabled');
  });

  it('refuses insecure cookies and development mail transports in production', () => {
    const error = configError({
      NODE_ENV: 'production',
      DATABASE_URL: STRONG_DB,
      SESSION_COOKIE_SECURE: 'false',
      MAIL_TRANSPORT: 'file',
    });
    expect(error.issues).toEqual([
      'SESSION_COOKIE_SECURE: must be true in production (serve the application over HTTPS)',
      'MAIL_TRANSPORT: "file" writes message contents (including reset links) to disk or logs; not allowed in production',
    ]);
  });

  it('requires a long setup token when one is provided', () => {
    expect(configError({ DATABASE_URL: DEV_DB, SETUP_TOKEN: 'short' }).issues).toContain(
      'SETUP_TOKEN: must be at least 24 characters',
    );
    expect(loadConfig({ DATABASE_URL: DEV_DB, SETUP_TOKEN: 'x'.repeat(32) }).setup.token).toBe(
      'x'.repeat(32),
    );
  });
});

describe('jobs, SMTP and media configuration', () => {
  it('defaults to an embedded worker, local media storage and the log mail transport in development', () => {
    const config = loadConfig({ DATABASE_URL: DEV_DB });
    expect(config.jobs).toMatchObject({
      worker: 'embedded',
      concurrency: 2,
      pollIntervalMs: 5_000,
    });
    expect(config.media).toMatchObject({
      storage: 'local',
      maxUploadBytes: 25 * 1024 * 1024,
      publicBaseUrl: null,
      s3: null,
    });
    expect(config.mail.transport).toBe('log');
    expect(config.content).toEqual({ trashRetentionDays: 30, revisionLimit: 50 });
  });

  it('uses SMTP by default in production when SMTP_HOST is set, otherwise disables mail', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: STRONG_DB };
    expect(loadConfig(base).mail.transport).toBe('disabled');
    const config = loadConfig({
      ...base,
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'secret-password',
      MAIL_FROM: 'Site <no-reply@example.com>',
    });
    expect(config.mail.transport).toBe('smtp');
    expect(config.mail.smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTls: true,
      rejectUnauthorized: true,
      user: 'mailer',
      password: 'secret-password',
    });
  });

  it('refuses SMTP without TLS or certificate checks, and localhost senders, in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: STRONG_DB,
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
    };
    const issues = configError({
      ...base,
      SMTP_REQUIRE_TLS: 'false',
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
    }).issues.join('\n');
    expect(issues).toMatch(/SMTP_REQUIRE_TLS: SMTP must use TLS in production/);
    expect(issues).toMatch(/SMTP_TLS_REJECT_UNAUTHORIZED: must be true in production/);
    expect(issues).toMatch(/MAIL_FROM: must be a real sender address in production/);
    // Implicit TLS is acceptable without STARTTLS.
    expect(
      loadConfig({
        ...base,
        SMTP_SECURE: 'true',
        SMTP_PORT: '465',
        SMTP_REQUIRE_TLS: 'false',
        MAIL_FROM: 'no-reply@example.com',
      }).mail.smtp?.secure,
    ).toBe(true);
  });

  it('requires complete SMTP and S3 settings', () => {
    const issues = configError({
      DATABASE_URL: DEV_DB,
      MAIL_TRANSPORT: 'smtp',
      SMTP_USER: 'only-user',
      MEDIA_STORAGE: 's3',
      S3_ACCESS_KEY_ID: 'only-key',
    }).issues;
    expect(issues).toContain('SMTP_HOST: is required when MAIL_TRANSPORT is "smtp"');
    expect(issues).toContain('SMTP_PASSWORD: SMTP_USER and SMTP_PASSWORD must be set together');
    expect(issues).toContain('S3_BUCKET: is required when MEDIA_STORAGE is "s3"');
    expect(issues).toContain(
      'S3_SECRET_ACCESS_KEY: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
    );
  });

  it('normalises media and S3 URLs', () => {
    const config = loadConfig({
      DATABASE_URL: DEV_DB,
      MEDIA_STORAGE: 's3',
      S3_BUCKET: 'nexora-media',
      S3_ENDPOINT: 'http://127.0.0.1:9000/',
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/media/',
      MEDIA_MAX_UPLOAD_MB: '10',
    });
    expect(config.media).toMatchObject({
      storage: 's3',
      publicBaseUrl: 'https://cdn.example.com/media',
      maxUploadBytes: 10 * 1024 * 1024,
      s3: { bucket: 'nexora-media', endpoint: 'http://127.0.0.1:9000', forcePathStyle: true },
    });
    expect(
      configError({ DATABASE_URL: DEV_DB, MEDIA_PUBLIC_BASE_URL: 'ftp://x' }).issues[0],
    ).toMatch(/^MEDIA_PUBLIC_BASE_URL: /);
  });
});
