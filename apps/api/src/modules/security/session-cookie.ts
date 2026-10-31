import type { CookieOptions, Response } from 'express';

/**
 * `__Host-` cookies must be Secure, have Path=/ and no Domain: the browser then guarantees the cookie
 * was set by this exact origin. Plain-HTTP development uses an unprefixed name.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-nexora_session' : 'nexora_session';
}

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,128}$/;

/** Reads one cookie from a Cookie header. Values that do not look like our tokens are ignored. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return TOKEN_FORMAT.test(value) ? value : null;
  }
  return null;
}

function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: '/' };
}

export function setSessionCookie(
  res: Response,
  secure: boolean,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(sessionCookieName(secure), token, { ...cookieOptions(secure), expires: expiresAt });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), cookieOptions(secure));
}
