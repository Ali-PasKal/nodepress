/**
 * HTTP security headers for the admin SPA — single source of truth.
 *
 * - Applied by `vite preview`, so the Playwright suite runs under the production policy.
 * - Mirrored in infrastructure/docker/admin/security-headers.conf (nginx); a unit test fails if the
 *   two drift apart.
 *
 * script-src is strictly 'self' (no inline scripts: the theme bootstrap is an external file).
 * style-src allows 'unsafe-inline' because Radix/react-remove-scroll inject small <style> elements
 * for scroll locking; CSS injection is far lower risk than script injection.
 */
export const ADMIN_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const ADMIN_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': ADMIN_CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
