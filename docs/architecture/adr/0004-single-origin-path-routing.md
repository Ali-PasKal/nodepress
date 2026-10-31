# ADR 0004 — Single-origin path routing by default

**Status:** Accepted (Milestone 1)

## Context
The admin SPA, the API and the public site can share one origin (like `/wp-admin`) or use separate origins.
This affects cookie security, CORS, CSRF and XSS blast radius.

## Decision
- Default topology: one origin, routed by path — `/admin/` (static admin SPA), `/api/` (API), `/` (public site, M4).
- The admin is built with `base: '/admin/'`; it calls the API with relative URLs and `credentials: 'same-origin'`.
- CORS is disabled unless exact origins are configured (`CORS_ALLOWED_ORIGINS`), which enables the hardened topology with the admin on its own origin.

## Consequences
- `SameSite=Strict` session cookies and no CORS in the default setup; simple hosting.
- The public site shares the admin's origin, so script injection on public pages would be same-origin with the admin (threat model R-03). Mitigated by the no-stored-script document model, sandboxed embeds and strict CSP; high-value sites should use a separate admin origin.
