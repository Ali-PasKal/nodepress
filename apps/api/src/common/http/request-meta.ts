import type { Request } from 'express';

/** Request facts recorded in audit events and sessions. Values are truncated to column sizes. */
export interface RequestMeta {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  const userAgent = req.get('user-agent');
  const id = (req as Request & { id?: unknown }).id;
  return {
    // req.ip honours the configured trusted proxies only.
    ipAddress: req.ip ? req.ip.slice(0, 64) : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    requestId: typeof id === 'string' ? id.slice(0, 128) : null,
  };
}
