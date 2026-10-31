import type { Request } from 'express';
import { deriveCsrfToken, safeEqual } from './crypto.js';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Rejects cross-site state-changing requests before any authentication happens (this also protects
 * login and setup, which have no session yet). Browsers send `Origin` on cross-origin and same-origin
 * POST/PUT/PATCH/DELETE; non-browser clients usually send neither header and are allowed (they cannot
 * carry a victim's cookies).
 */
export function isTrustedOrigin(req: Request, allowedOrigins: readonly string[]): boolean {
  const origin = req.get('origin');
  if (origin !== undefined) {
    if (origin === 'null') {
      return false;
    }
    try {
      if (new URL(origin).host === req.get('host')) {
        return true;
      }
    } catch {
      return false;
    }
    return allowedOrigins.includes(origin);
  }
  return req.get('sec-fetch-site') !== 'cross-site';
}

/** Verifies the per-session synchroniser token sent in `X-CSRF-Token`. */
export function hasValidCsrfToken(req: Request, sessionToken: string): boolean {
  const provided = req.get(CSRF_HEADER);
  return (
    typeof provided === 'string' &&
    provided.length > 0 &&
    safeEqual(provided, deriveCsrfToken(sessionToken))
  );
}
