import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Restrictive format so a forwarded id cannot inject control characters or huge values into logs. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export type RequestWithId = Request & { id?: string };

/**
 * Assigns every request a correlation id before any other middleware runs, so even requests rejected
 * by body parsing carry an id in logs and in the error envelope. An inbound X-Request-Id is honoured
 * only when explicitly enabled (i.e. a trusted proxy sets it) and only if it matches a safe format.
 */
export function createRequestIdMiddleware(trustInbound: boolean) {
  return function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const id =
      trustInbound && typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound)
        ? inbound
        : randomUUID();
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
