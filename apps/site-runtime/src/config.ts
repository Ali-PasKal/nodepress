import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SITE_HOST: z.string().min(1).default('127.0.0.1'),
  SITE_PORT: z.coerce.number().int().min(1).max(65_535).default(4321),
  /** Base URL of the NEXORA API (only its public Delivery endpoints are used). */
  DELIVERY_API_URL: z
    .url({ protocol: /^https?$/, message: 'Use an http(s) URL.' })
    .default('http://127.0.0.1:3000'),
  SITE_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface SiteConfig {
  readonly env: 'development' | 'production' | 'test';
  readonly host: string;
  readonly port: number;
  readonly deliveryApiUrl: string;
  readonly apiTimeoutMs: number;
  readonly logLevel: string;
}

/** Validated runtime configuration. The site runtime holds no secrets and needs no database access. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SiteConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid site runtime configuration: ${problems}`);
  }
  const value = parsed.data;
  return {
    env: value.NODE_ENV,
    host: value.SITE_HOST,
    port: value.SITE_PORT,
    deliveryApiUrl: value.DELIVERY_API_URL.replace(/\/+$/, ''),
    apiTimeoutMs: value.SITE_API_TIMEOUT_MS,
    logLevel: value.LOG_LEVEL,
  };
}
