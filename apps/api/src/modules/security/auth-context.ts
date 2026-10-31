/** Authenticated request state, attached by AccessGuard as `req.auth`. */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  /** Raw session token from the cookie; used only to derive/verify the CSRF token. */
  readonly sessionToken: string;
  readonly sessionExpiresAt: Date;
  readonly siteId: string;
  readonly role: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly grantsAll: boolean;
  } | null;
  readonly capabilities: ReadonlySet<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express exposes its Request type via this global namespace.
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
