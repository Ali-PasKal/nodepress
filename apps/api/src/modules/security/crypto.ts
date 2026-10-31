import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 digest, used to store tokens so a database leak does not reveal usable secrets. Returned as a
 * plain Uint8Array (the type Prisma uses for BYTEA columns).
 */
export function sha256(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(value, 'utf8').digest());
}

/** Constant-time comparison of two digests or strings (compared via their SHA-256 to equalise length). */
export function safeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const left = typeof a === 'string' ? sha256(a) : a;
  const right = typeof b === 'string' ? sha256(b) : b;
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * CSRF token bound to a session: HMAC of a fixed label keyed by the session token. Only someone holding
 * the (HttpOnly) session cookie can know it, and it changes whenever the session rotates. Nothing extra
 * needs to be stored.
 */
export function deriveCsrfToken(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('nexora:csrf:v1').digest('base64url');
}
