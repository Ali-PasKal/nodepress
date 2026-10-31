export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Express `trust proxy` value: disabled, a hop count, or explicit proxy addresses/subnets. */
export type TrustProxySetting = false | number | readonly string[];

/** Typed, validated, immutable application configuration. Built once at startup by `loadConfig`. */
export interface AppConfig {
  readonly env: NodeEnvironment;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly trustProxy: TrustProxySetting;
    /** Accept a well-formed inbound X-Request-Id (only behind a trusted proxy that sets it). */
    readonly trustRequestIdHeader: boolean;
    /** Exact origins allowed to make credentialed cross-origin requests. Empty = same-origin only. */
    readonly corsAllowedOrigins: readonly string[];
    readonly bodyLimit: string;
    readonly requestTimeoutMs: number;
    /** Time to keep serving (with readiness failing) after SIGTERM so load balancers can drain. */
    readonly shutdownDelayMs: number;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly connectTimeoutMs: number;
    readonly statementTimeoutMs: number;
    readonly migrationsDir: string;
  };
  readonly cache: {
    readonly redisUrl: string | null;
  };
  readonly logging: {
    readonly level: LogLevel;
    readonly format: 'json' | 'pretty';
  };
  readonly openapi: {
    readonly enabled: boolean;
  };
  readonly health: {
    readonly checkTimeoutMs: number;
  };
}

/** Injection token for the AppConfig object. */
export const APP_CONFIG = Symbol('APP_CONFIG');
