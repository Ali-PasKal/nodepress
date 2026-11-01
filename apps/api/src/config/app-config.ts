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
  readonly session: {
    readonly cookieSecure: boolean;
    readonly idleTimeoutMs: number;
    readonly absoluteTimeoutMs: number;
  };
  readonly setup: {
    /** Operator-provided setup token (SETUP_TOKEN); null means generate one at startup. */
    readonly token: string | null;
  };
  readonly mail: {
    readonly transport: 'log' | 'file' | 'smtp' | 'disabled';
    readonly fileDir: string;
    readonly from: string;
    /** Present when transport is "smtp". */
    readonly smtp: SmtpConfig | null;
  };
  readonly jobs: {
    /** "embedded": this process runs a worker; "off": jobs are only enqueued (a separate worker runs them). */
    readonly worker: 'embedded' | 'off';
    readonly concurrency: number;
    readonly pollIntervalMs: number;
    /** A running job whose worker has not finished it within this time is considered abandoned. */
    readonly lockTimeoutMs: number;
    readonly retryBaseMs: number;
    readonly shutdownGraceMs: number;
  };
  readonly media: {
    readonly storage: 'local' | 's3';
    readonly localDir: string;
    readonly maxUploadBytes: number;
    /** Public URL prefix for stored files (e.g. a CDN or public bucket); null = served by the API at /uploads. */
    readonly publicBaseUrl: string | null;
    readonly s3: S3Config | null;
  };
  readonly content: {
    readonly trashRetentionDays: number;
    readonly revisionLimit: number;
  };
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (usually port 465). */
  readonly secure: boolean;
  /** Require STARTTLS when not using implicit TLS. */
  readonly requireTls: boolean;
  readonly rejectUnauthorized: boolean;
  readonly user: string | null;
  readonly password: string | null;
}

export interface S3Config {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint: string | null;
  readonly accessKeyId: string | null;
  readonly secretAccessKey: string | null;
  readonly forcePathStyle: boolean;
}

/** Injection token for the AppConfig object. */
export const APP_CONFIG = Symbol('APP_CONFIG');
