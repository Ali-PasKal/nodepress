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
