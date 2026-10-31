import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import type { AppConfig } from '../config/app-config.js';

export const OPENAPI_UI_PATH = '/api/docs';

const sharedHelmetOptions = {
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  // Browsers ignore HSTS over plain HTTP, so this is harmless in development. includeSubDomains is
  // left to the operator's TLS-terminating proxy because it affects every subdomain.
  strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false },
  xFrameOptions: { action: 'deny' },
} satisfies HelmetOptions;

/** JSON API responses never need to load anything: lock the policy down completely. */
const apiHelmet = helmet({
  ...sharedHelmetOptions,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
});

/** The interactive docs UI loads its own same-origin scripts and styles (swagger-ui uses inline styles). */
const docsHelmet = helmet({
  ...sharedHelmetOptions,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});

function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const handler: RequestHandler = req.path.startsWith(OPENAPI_UI_PATH) ? docsHelmet : apiHelmet;
  handler(req, res, next);
}

/** API responses may contain private data: forbid shared/browser caching unless a route opts in. */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

export function applyHttpSecurity(app: NestExpressApplication, config: AppConfig): void {
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(noStore);

  // Same-origin by default. Cross-origin access is only granted to explicitly listed origins; requests
  // from any other origin receive no CORS headers at all (not even Allow-Credentials).
  const allowedOrigins = new Set(config.http.corsAllowedOrigins);
  if (allowedOrigins.size === 0) {
    return;
  }
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.vary('Origin');
    next();
  });
  const corsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
    const origin = req.header('Origin');
    if (origin === undefined || !allowedOrigins.has(origin)) {
      callback(null, { origin: false });
      return;
    }
    callback(null, {
      origin,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    });
  };
  app.enableCors(corsDelegate);
}
