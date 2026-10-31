# Milestone 2 — Identity, access control and audit

## Starting point
M1 delivered the API kernel (config, logging, security headers, health), the `system_state` table, the admin
shell with one public status page, and no authentication. Every endpoint is public.

## Scope

**In scope**
- Data model: `sites` (default site; future multi-site scoping), `users`, `user_credentials` (hashes kept
  out of user rows), `sessions`, `roles`, `capabilities`, `role_capabilities`, `role_assignments`
  (per site), `password_reset_tokens`, `audit_events` (append-only), `rate_limit_buckets`.
- Setup wizard (API + UI): environment check → site name and base URL → security check → first super
  administrator → install. Protected by a one-time **setup token** printed at API startup (or `SETUP_TOKEN`),
  safe to retry, permanently locked once installed.
- Authentication: email + password (Argon2id), server-side sessions in an HttpOnly cookie, idle and absolute
  expiry, rotation on login and password change, revocation (one, all others, all of a user).
- CSRF: synchroniser token bound to the session (`X-CSRF-Token`) for cookie-authenticated mutations, plus
  `Origin`/`Sec-Fetch-Site` verification on every unsafe request (including login and setup).
- Abuse protection: rate limits for login (per IP and per account), password reset and setup; Redis when
  configured, PostgreSQL otherwise. Generic login errors and timing equalisation (no user enumeration).
- Authorisation: capability-based, **secure by default** (every route requires a session unless marked
  public; protected routes declare capabilities; a test fails if a route declares neither).
  Privilege-escalation rules: nobody can grant capabilities they do not hold, modify a user who holds
  capabilities they lack, change their own role, or remove the last active super administrator.
- Default roles: Super Administrator, Administrator, Editor, Author, Contributor, Viewer. Roles are
  configurable (custom roles, capability editing); system roles cannot be deleted.
- Users API/UI: list, search, paginate, create, edit, change role, suspend/reactivate, set password,
  view and revoke sessions. Profile: display name, change password, own sessions.
- Password reset: single-use, hashed, expiring tokens; generic responses. Mail transports: `log` and
  `file` (development/test). Operator recovery: `nexora user reset-password --email <email>`.
- Audit log of security-relevant events, with a read-only API/UI.
- Request validation with Zod at the transport boundary.

**Out of scope (later milestones, stated honestly in the UI and docs)**
- SMTP delivery and the durable background job queue (M3). Until then, password reset emails can only be
  delivered by the development transports; administrators can set passwords and operators can use the CLI.
- Email verification, MFA/2FA, SSO/OAuth, API tokens for non-browser clients.
- Content capabilities (pages, posts, media): added with the content model in M3. In M2 the Editor, Author,
  Contributor and Viewer roles can only sign in and manage their own profile.
- Theme selection in the setup wizard (themes arrive in M4).

## Key decisions
| Decision | Rationale |
|---|---|
| Opaque random session token in cookie; only its SHA-256 stored | DB leak does not yield usable sessions |
| Argon2id via `@node-rs/argon2` (m=19 MiB, t=2, p=1; rehash on login when parameters change) | OWASP-recommended baseline; prebuilt binaries, no install scripts |
| Cookie `__Host-nexora_session` when Secure, `nexora_session` in plain-HTTP development | `__Host-` prefix pins the cookie to the origin; production requires Secure |
| Capabilities stored in a table seeded by migrations; `grants_all` flag for Super Administrator | Referential integrity for role grants; super admins automatically hold future capabilities |
| One role per user per site (`role_assignments` keyed by user + site) | Matches common CMS mental model; site key keeps multi-site possible |
| Setup token | Prevents a stranger from claiming a freshly deployed, not-yet-installed instance |
| `audit_events` protected by a trigger that rejects UPDATE/DELETE | Tamper resistance against application bugs (not against a DB superuser) |

## Risks
- Session fixation and CSRF mistakes → covered by dedicated tests (rotation, token binding, origin checks).
- User enumeration via timing → dummy hash verification for unknown accounts; identical responses.
- Privilege escalation through role edits → subset rule enforced in one service, with tests per path.
- Lockout of the only administrator → last-super-admin guard and operator CLI recovery.
- Rate limiter memory or DB growth → fixed windows with expiry (Redis TTL / periodic purge).

## Acceptance criteria
1. A fresh install can only be completed with a valid setup token; afterwards every setup endpoint returns 409/404 and cannot create users.
2. Login sets an HttpOnly, SameSite=Strict session cookie (Secure in production); logout and revocation invalidate it server-side immediately.
3. Sessions expire after the idle and absolute timeouts; a new session is issued on login and on password change (old ones revoked).
4. Every state-changing request authenticated by cookie fails without a valid CSRF token; cross-origin unsafe requests are rejected even before authentication.
5. Login, password reset and setup are rate limited (429 + `Retry-After`) with Redis and without it.
6. Unknown email and wrong password produce identical responses.
7. Every non-public route requires a session and a declared capability — enforced by an automated route inventory test; 401/403 paths are tested for each module.
8. Escalation rules hold: no granting of unheld capabilities, no self role change, no editing more privileged users, the last active super admin cannot be demoted or suspended.
9. Password reset tokens are single-use, expire, are stored hashed, and revoke existing sessions when used.
10. Security-relevant actions write audit events in the same transaction; audit rows cannot be updated or deleted by the application.
11. Admin UI: setup wizard, login, forgot/reset password, users, roles, audit log, profile and sessions work against the real API, with loading/empty/error states, confirmation for destructive actions, keyboard-accessible dialogs, responsive at 375/768/1280.
12. All checks (lint, format, typecheck, build, unit/integration, E2E, drift, audit) pass on Node 22 and Node 23.7; CI green.
