import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { deriveCsrfToken, generateToken, safeEqual, sha256 } from './crypto.js';
import { hasValidCsrfToken, isTrustedOrigin, isUnsafeMethod } from './csrf.js';
import { readCookie, sessionCookieName } from './session-cookie.js';

function fakeRequest(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

describe('tokens', () => {
  it('generates distinct URL-safe tokens of the requested entropy', () => {
    const a = generateToken(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken(32)).not.toBe(a);
  });

  it('derives a CSRF token bound to the session token', () => {
    const session = generateToken();
    expect(deriveCsrfToken(session)).toBe(deriveCsrfToken(session));
    expect(deriveCsrfToken(generateToken())).not.toBe(deriveCsrfToken(session));
  });

  it('compares secrets in constant time regardless of length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(sha256('x'), sha256('x'))).toBe(true);
    expect(sha256('x')).toHaveLength(32);
  });
});

describe('session cookie parsing', () => {
  const token = 'A'.repeat(43);
  it('reads our cookie among others and ignores malformed values', () => {
    expect(readCookie(`theme=dark; nexora_session=${token}; other=1`, 'nexora_session')).toBe(
      token,
    );
    expect(readCookie('nexora_session=<script>', 'nexora_session')).toBeNull();
    expect(readCookie('nexora_sessionX=abc', 'nexora_session')).toBeNull();
    expect(readCookie(undefined, 'nexora_session')).toBeNull();
  });

  it('uses the __Host- prefix only for Secure cookies', () => {
    expect(sessionCookieName(true)).toBe('__Host-nexora_session');
    expect(sessionCookieName(false)).toBe('nexora_session');
  });
});

describe('CSRF origin checks', () => {
  it('classifies methods', () => {
    expect(['GET', 'head', 'OPTIONS'].map(isUnsafeMethod)).toEqual([false, false, false]);
    expect(['POST', 'put', 'PATCH', 'DELETE'].map(isUnsafeMethod)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it.each([
    [{ host: 'cms.example', origin: 'https://cms.example' }, [], true],
    [{ host: 'cms.example:8080', origin: 'http://cms.example:8080' }, [], true],
    [{ host: 'cms.example', origin: 'https://evil.example' }, [], false],
    [{ host: 'cms.example', origin: 'https://admin.example' }, ['https://admin.example'], true],
    [{ host: 'cms.example', origin: 'null' }, [], false],
    [{ host: 'cms.example', 'sec-fetch-site': 'cross-site' }, [], false],
    [{ host: 'cms.example', 'sec-fetch-site': 'same-origin' }, [], true],
    [{ host: 'cms.example' }, [], true],
  ] as const)('%j (allowlist %j) → %s', (headers, allowed, expected) => {
    expect(isTrustedOrigin(fakeRequest(headers), allowed)).toBe(expected);
  });

  it('accepts only the CSRF token derived from the presented session', () => {
    const session = generateToken();
    expect(
      hasValidCsrfToken(fakeRequest({ 'x-csrf-token': deriveCsrfToken(session) }), session),
    ).toBe(true);
    expect(
      hasValidCsrfToken(fakeRequest({ 'x-csrf-token': deriveCsrfToken(generateToken()) }), session),
    ).toBe(false);
    expect(hasValidCsrfToken(fakeRequest({}), session)).toBe(false);
  });
});
