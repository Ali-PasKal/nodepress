import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { AppConfig } from '../config/app-config.js';

/** Headers that may carry credentials. Redacted wherever they could appear in a log line. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
];

const HEALTH_PATH_PREFIX = '/api/v1/health/';

/** Shape produced by pino's request serializer wrapper; `raw` is the original Express request. */
interface SerializedRequest {
  method?: string;
  url?: string;
  remoteAddress?: string;
  raw?: { ip?: string };
}

/** Strips the query string: it may contain one-time tokens (password reset, preview links). */
function pathOnly(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * @param destination Optional log sink (tests capture output this way); defaults to stdout.
 */
export function buildLoggerOptions(config: AppConfig, destination?: DestinationStream): Params {
  const options = {
    level: config.logging.level,
    ...(config.logging.format === 'pretty'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } } }
      : {}),
    // The request id is assigned by requestIdMiddleware, which runs before every other middleware.
    genReqId: (req: IncomingMessage) => (typeof req.id === 'string' ? req.id : 'unassigned'),
    customAttributeKeys: { reqId: 'requestId' },
    // Bind only the request id to logs written while handling a request; the full request/response
    // summary appears once, on the access log line.
    quietReqLogger: true,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // Probes are high-frequency and carry no diagnostic value when successful.
    autoLogging: {
      ignore: (req: IncomingMessage) => (req.url ?? '').startsWith(HEALTH_PATH_PREFIX),
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err !== undefined || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    // Minimal, explicit serializers: no headers or bodies are logged by default.
    serializers: {
      req: (req: SerializedRequest) => ({
        method: req.method,
        path: pathOnly(req.url),
        // Express resolves the client address through the configured trusted proxies.
        remoteAddress: req.raw?.ip ?? req.remoteAddress,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  } satisfies Params['pinoHttp'];
  return { pinoHttp: destination ? [options, destination] : options };
}
