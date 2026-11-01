# NEXORA CMS — Security Architecture and Threat Model

| | |
|---|---|
| Status | Living document. Revised at the start of every milestone. |
| Last reviewed | Milestone 4 (public site, themes, Delivery API) |
| Scope | All components in [the architecture overview](../architecture/overview.md) |

NEXORA does **not** claim to be invulnerable or "more secure than WordPress". It aims for a documented
defense-in-depth design in which every control is either implemented and tested, or explicitly listed as
planned or as a residual risk. Each control below is marked **Implemented (M1)**, **Planned (Mx)**, or
**Residual**.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Admin sessions and credentials | Full control of the site and its content |
| Unpublished content (drafts, scheduled posts, previews) | Confidentiality until publication |
| Form submissions (personal data) | Privacy and legal obligations (GDPR etc.) |
| Published site integrity | Defacement, malware distribution, SEO spam |
| Database and backups | Everything above, at rest |
| Secrets (DB credentials, storage keys, SMTP, integration tokens) | Lateral movement into other systems |
| Server and network position | Pivot point into the operator's private network (SSRF) |

## 2. Trust boundaries

```
 [Internet] ──(1)── [Edge: TLS proxy / nginx] ──(2)── [api]  ──(4)── [PostgreSQL]
                                │                       │ └──(5)── [Valkey/Redis]
                                │                       └───(6)── [Object storage]   (M3)
                                ├──(3)── [admin static assets]
                                └──(9)── [site runtime] ──(10)── [api: public Delivery endpoints only]   (M4)
 [Plugin code] ──(7)── [extension runtime]  (M6)        [Outbound HTTP] ──(8)── [Internet / private net]  (M3+)
```

1. **Internet → edge.** Everything inbound is untrusted. TLS terminates here in production.
2. **Edge → API.** The API trusts forwarding headers only from configured proxy hops (`TRUST_PROXY`), and request ids only when `TRUST_REQUEST_ID_HEADER` is set.
3. **Admin assets.** Static files only; no server-side logic in the admin container.
4. **API → database.** Parameterised queries via Prisma. The runtime role can be restricted to DML, with migrations using `MIGRATION_DATABASE_URL`.
5. **API → cache.** Optional. Treated as untrusted storage for anything security-relevant: correctness must not depend on it.
6. **API → object storage** (M3). Server-generated keys only; private objects are served through authorised endpoints or short-lived signed URLs.
7. **Core → plugins** (M6). A plugin manifest is metadata, not a security boundary (see §5.4).
8. **API → outbound network** (M3+: media import, WordPress import, webhooks, analytics). Guarded against SSRF.
9. **Edge → site runtime** (M4). Renders public pages; holds no secrets and has no database access, so it cannot read drafts even if compromised.
10. **Site runtime → API** (M4). Only the public, read-only Delivery endpoints; responses are validated against the shared contracts before rendering.

## 3. Threat actors and scenarios

### 3.1 Anonymous visitors
- **Goals:** read unpublished content, inject script into pages (XSS), abuse forms/search for spam or DoS, enumerate users, exploit known CMS vulnerabilities, brute-force logins.
- **Mitigations:**
  - Implemented (M1): request body size limits (413); per-handler timeouts (503) and transport timeouts; strict security headers with CSP `default-src 'none'` on API responses; uniform error envelope that never reflects input or leaks stack traces; the unauthenticated readiness endpoint coalesces probes into at most one dependency check per second; `Cache-Control: no-store` by default; production disables API docs by default.
  - Implemented (M2): rate limits on sign-in (20 per IP per 5 min; 5 failures per account per 15 min, then locked for the window even with the right password), password reset (5 per IP per 15 min; 3 per account per hour, silently) and setup (10 per IP per 15 min), backed by Redis when available and PostgreSQL otherwise; identical responses and comparable timing (dummy Argon2 verification) for unknown accounts, wrong passwords and suspended accounts; password reset responds identically whether or not the account exists and sends mail in the background; a one-time setup token prevents strangers from claiming a fresh install.
  - Implemented (M4): the Delivery API is the only public read path and every query goes through one "publicly visible" predicate (published, not trashed, publication time reached, public content type) plus a path-based ancestor check for hierarchical entries; tested per status, scheduling, trash, non-public types and unpublished ancestors, with a mutation check (removing any clause makes a test fail). Custom fields are only delivered when marked public (off by default); authors are exposed by display name only.
  - Implemented (M4): preview links are 256-bit random tokens stored as SHA-256, valid for one hour, invalid once the entry is trashed or the creator suspended; responses are `no-store`, `noindex, nofollow` and `Referrer-Policy: no-referrer`, and nginx keeps `/_preview/` out of its access log.
  - Implemented (M4): public pages are served with `default-src 'none'; style-src 'self'; img-src 'self' data: https:` and no script source at all (structured data uses non-executable JSON-LD blocks, escaped against `</script>`); React escapes all text; sitemap and RSS are XML-escaped; redirect targets are site paths or credential-free http(s) URLs.
  - Planned (M7): form spam mitigation (honeypot + rate limits + optional challenge), server-side validation.

### 3.2 Authenticated content editors (Author, Contributor, Editor)
- **Goals (malicious or compromised account):** stored XSS through rich text or HTML embeds to hijack an administrator's session; privilege escalation; editing or deleting other users' content.
- **Mitigations:**
  - Implemented (M2): capability-based authorisation on every route via a global, fail-closed guard (a route without a declared policy is refused, and a test inventories every route); privilege-escalation rules (no granting unheld capabilities, no managing more privileged users, no self role/status changes, no editing one's own role, last active Super Administrator protected); role and status changes revoke the target's sessions; append-only audit log.
  - Implemented (M3): one content policy for own vs. others' entries, live content and publishing rights, tested for every built-in role (including a mutation check that the tests catch a weakened rule); entries a user may not see return 404.
  - Implemented (M3): rich text is stored as ProseMirror JSON validated against an allowlist (no HTML, no unknown nodes or marks, link targets limited to http(s)/mailto/tel/same-site, images limited to `/uploads/` or http(s)); nesting depth is checked before parsing; the admin renders stored content as React elements, re-checking URLs.
  - Implemented (M4): the public renderer (theme SDK) emits only the allowlisted rich-text constructs as React elements and re-checks link and image URLs; the public pages' CSP allows no scripts, so injected markup cannot execute. Planned (M5): HTML Embed in a sandboxed `iframe` without `allow-same-origin`.
  - Implemented (M1): admin CSP has `script-src 'self'` with no inline scripts (enforced by an E2E test that fails on any CSP violation).

### 3.3 Administrators
- **Goals (compromised account or malicious insider):** install a malicious plugin, exfiltrate data, read secrets, persist access.
- **Mitigations:**
  - Planned: re-authentication for sensitive actions (M2); audit log of privileged actions (M2); plugins require explicit approval as trusted code, with sandboxing for third-party plugins (M6); secrets are never returned by the API once stored (M2+).
  - Residual: an administrator who approves a malicious *trusted* plugin can compromise the instance. This is inherent to running server-side extensions in-process and is documented to administrators.

### 3.4 Malicious plugins (M6)
- **Goals:** read secrets or the database directly, make outbound requests, inject script into the admin, persist backdoors.
- **Mitigations (planned):** trust tiers (declarative / sandboxed / trusted); sandboxed plugins run in a separate isolated process with no direct database, filesystem or network access, with resource limits and a capability-checked RPC API; plugin admin UIs run in sandboxed iframes on a separate origin and never inside the admin origin; transactional activation with rollback.
- **Explicit non-claim:** a Node.js process, a manifest, or TypeScript types do **not** sandbox code. In-process "trusted" plugins have full privileges.

### 3.5 Compromised dependencies (supply chain)
- Implemented (M1): exact version pinning plus a committed lockfile; `pnpm install --frozen-lockfile` in CI and Docker builds; dependency lifecycle scripts blocked by default (pnpm 10), with an explicit allowlist (`onlyBuiltDependencies`: `@prisma/engines` only; Prisma's version-gate script is explicitly ignored) and install-time telemetry explicitly blocked; `pnpm audit --prod --audit-level=high` gates CI; GitHub Actions pinned to commit SHAs with read-only `contents` permission and `persist-credentials: false`.
- Planned (M8): SBOM generation, image scanning, Renovate/Dependabot with review, signed release artifacts.
- Residual: a malicious release of a pinned dependency that is not yet known to advisory databases.

### 3.6 Malicious uploaded files (M3)
- Implemented (M3): type detection by file signature (extension and client MIME type ignored) against an allowlist (JPEG, PNG, GIF, WebP, AVIF, PDF, MP4, WebM, MP3, OGG, WAV; SVG and HTML rejected); size, part and per-user rate limits; a pixel limit against decompression bombs; raster images re-encoded by libvips (sharp), which drops metadata (EXIF/GPS) and anything appended to the file; server-generated storage keys validated again when serving (traversal impossible); files served with the content type derived from the server-chosen extension, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Disposition: attachment` for documents.
- Residual: uploads share the admin's origin by default (R-16); GIF, PDF, audio and video are stored as uploaded (R-15).

### 3.7 Database compromise
- Implemented (M1): the readiness endpoint never exposes connection details; config validation refuses known development passwords in production; support for a separate migration role so the runtime role can be DML-only.
- Planned: Argon2id password hashing (M2); session tokens stored only as SHA-256 hashes (M2); secrets for integrations encrypted at rest with a key held outside the database (M6); backup encryption guidance (M8).
- Residual: an attacker with database write access can modify content and roles. Detection relies on audit logs stored in the same database (M8: optional external log shipping).

### 3.8 Misconfigured production deployments
- Implemented (M1): the API refuses to start in production with development credentials, pretty (non-JSON) logs, or non-HTTPS CORS origins; `TRUST_PROXY=true` (trust everyone) is rejected outright; wildcard CORS origins are rejected; API docs are off in production unless explicitly enabled; containers run as non-root with read-only root filesystems, `cap_drop: ALL` and `no-new-privileges`; Compose binds service ports to `127.0.0.1` only; the nginx edge overwrites (does not append to) `X-Forwarded-For` and `X-Request-Id`.
- Planned (M8): production deployment checklist and hardening review; health/readiness integration guidance; backup restoration drills.

### 3.9 Cross-tenant attacks
- Not applicable: multi-tenancy is not implemented. The design reserves `site_id` scoping (see the architecture overview, §6.3). If tenancy is introduced, every query, cache key, storage key, job and authorisation decision must carry the site id, and cross-tenant access must be covered by automated tests before release.

## 4. Control inventory

| Control | Status | Where / evidence |
|---|---|---|
| Runtime-validated configuration with production safety rules | Implemented (M1) | `apps/api/src/config/env.schema.ts`; `env.schema.test.ts` |
| Security headers + CSP (API, docs UI, admin) | Implemented (M1) | `apps/api/src/bootstrap/http-security.ts`; `apps/admin/security-headers.ts`; nginx snippet; `http-security.test.ts`, `security-headers.test.ts`, E2E "no CSP violations" |
| CORS exact-origin allowlist, none by default | Implemented (M1) | `http-security.ts`; tests for allowed, denied and preflight cases |
| No `eval`/`new Function` in the admin (Zod jitless; CSP without `'unsafe-eval'`) | Implemented (M1) | `apps/admin/src/zod-config.ts`; E2E "no CSP violations" |
| Request body limit (JSON only) | Implemented (M1) | `create-app.ts`; 413 test |
| Request timeouts (handler + transport + DB `statement_timeout`) | Implemented (M1) | `timeout.interceptor.ts`, `main.ts`, `prisma.service.ts` |
| Safe error envelope (no stack traces or reflected input) | Implemented (M1) | `error-mapping.ts`, `global-exception.filter.ts`; unit and integration tests |
| Request correlation ids (inbound only from a trusted proxy, format-validated) | Implemented (M1) | `request-id.middleware.ts`; tests |
| Structured logs; credentials, cookies and query strings never logged | Implemented (M1) | `logger-options.ts`; `logging.test.ts` |
| Client IP resolved only through trusted proxies | Implemented (M1) | `logging*.test.ts` |
| Graceful shutdown (readiness fails while draining) | Implemented (M1) | `shutdown-state.service.ts`; tests |
| DB constraints for invariants Prisma cannot express | Implemented (M1) | migration `CHECK`; test |
| Migration drift detection | Implemented (M1) | `db:check-drift`; `migrations.test.ts`; CI |
| Supply-chain basics (lockfile, blocked install scripts, SHA-pinned actions, audit) | Implemented (M1) | `pnpm-workspace.yaml`, `.github/workflows/ci.yml` |
| Container hardening | Implemented (M1) | Dockerfiles, `docker-compose.yml` (verified: uid 1000, read-only rootfs) |
| Argon2id password hashing (OWASP baseline parameters, rehash on login when they change) | Implemented (M2) | `password-hasher.service.ts` |
| Server-side sessions: opaque 256-bit token in an HttpOnly, SameSite=Strict (`__Host-`, Secure in production) cookie; only the SHA-256 is stored; idle + absolute expiry; rotation on login and password change; revocation | Implemented (M2) | `session.service.ts`, `session-cookie.ts`; `auth.test.ts` |
| CSRF: origin/`Sec-Fetch-Site` check on every unsafe request (incl. login/setup) + session-bound HMAC token in `X-CSRF-Token` | Implemented (M2) | `csrf.ts`, `access.guard.ts`; `auth.test.ts`, `security-helpers.test.ts` |
| Secure-by-default authorisation (fail-closed guard, capability declarations, route inventory test) | Implemented (M2) | `access.guard.ts`; `access-control.test.ts` |
| Privilege-escalation rules and last-super-admin guard | Implemented (M2) | `users.service.ts`, `roles.service.ts`; `access-control.test.ts`, `last-super-admin.test.ts` |
| Rate limiting (Redis or PostgreSQL) | Implemented (M2) | `rate-limiter.service.ts`; `auth.test.ts`, `password-reset.test.ts` |
| Single-use, hashed, 30-minute password reset tokens; reset revokes all sessions | Implemented (M2) | `password-reset.service.ts`; `password-reset.test.ts` |
| One-time setup token; setup serialised by an advisory lock; locked after install | Implemented (M2) | `setup.service.ts`; `setup.test.ts` |
| Append-only audit log (DB trigger), written in the same transaction as the audited change; no secrets in metadata | Implemented (M2) | migration `…_identity_access_audit`; `audit.test.ts` |
| Request validation with shared Zod contracts (422 with per-field issues) | Implemented (M2) | `zod-validation.pipe.ts` |
| Rich-text allowlist schema (no stored HTML; safe link/image URLs; bounded nesting) | Implemented (M3) | `packages/shared/src/contracts/rich-text.ts`; `content.test.ts` (hostile inputs), `entries.test.ts`, admin `content-ui.test.tsx` |
| Content ownership policy (own/others/live/publish) | Implemented (M3) | `content-policy.ts`; `content-permissions.test.ts` (every built-in role) |
| Optimistic concurrency for entries (409 on stale versions) | Implemented (M3) | `entries.service.ts`; `entries.test.ts`, E2E |
| Upload validation (signature sniffing, allowlist, size/pixel limits, re-encoding without metadata, server keys) | Implemented (M3) | `media.service.ts`, `image-processor.ts`, `media-types.ts`; `media.test.ts` |
| Safe file serving (`/uploads`: key validation, nosniff, sandboxing CSP, attachment for documents, ranges) | Implemented (M3) | `uploads.handler.ts`; `media.test.ts` (local and S3) |
| Durable jobs; secrets never in job payloads (reset token created by the job) | Implemented (M3) | `jobs/*`, `password-reset.service.ts`; `jobs.test.ts`, `mail.test.ts` |
| SMTP with TLS and certificate verification required in production | Implemented (M3) | `env.schema.ts`, `mailer.service.ts`; `env.schema.test.ts`, `mail.test.ts` |
| Expiry-based purging of sessions, tokens, rate-limit buckets, jobs, trash | Implemented (M3) | `maintenance.service.ts`, `entries.service.ts`; `maintenance.test.ts`, `entries.test.ts` |
| SSRF guard (outbound fetches) | Planned (with the first feature that fetches URLs: M6/M7) | — |
| Delivery API draft isolation (one visibility predicate + ancestor check), public-field opt-in | Implemented (M4) | `delivery/public-content.ts`, `delivery.service.ts`; `delivery.test.ts` |
| Hashed, expiring preview tokens; private preview responses | Implemented (M4) | `entries.service.ts` (`createPreview`), `delivery.service.ts`, site runtime `app.ts`; `delivery.test.ts`, `app.test.ts` |
| Public pages: CSP without scripts or inline styles, escaped head/JSON-LD/XML, ETags, 503 on API outage | Implemented (M4) | `apps/site-runtime/src/{app,html,seo,xml,themes}.ts`; `app.test.ts`, E2E `public-site.spec.ts` |
| Reserved paths and route prefix collisions; redirect source/target validation; loop detection | Implemented (M4) | `content-model.service.ts`, `entries.service.ts`, `redirects.service.ts`, shared `redirects.ts`; `routes-redirects.test.ts` |
| Theme settings validated against the theme manifest (CSS variable values re-validated by the runtime) | Implemented (M4) | shared `themes.ts`, `site-settings.service.ts`, runtime `themes.ts`; `appearance.test.ts`, `app.test.ts` |
| Plugin isolation | Planned (M6) | — |

## 5. Design decisions with security impact

### 5.1 Same-origin admin by default
Admin (`/admin/`), API (`/api/`) and the public site share one origin, which keeps cookies `SameSite=Strict`
and removes CORS entirely. The trade-off (risk **R-03**): script running on the public site would run in the
admin's origin. Since M4 the public pages' CSP contains no script source at all (`default-src 'none'`), so even
injected markup cannot execute script; content is stored as allowlisted JSON (never HTML), themes are
first-party code, and HTML embeds (M5) will be sandboxed in iframes. A separate admin origin is supported (via
`CORS_ALLOWED_ORIGINS`) and recommended for high-value sites.

### 5.2 Readiness is public, but minimal and rate-coalesced
Orchestrators need unauthenticated probes. Readiness reveals only coarse up/down states and migration
counts — never hostnames, error messages or versions — and concurrent probes share one result per second.

### 5.3 Inbound correlation ids are opt-in
Accepting client-chosen request ids would let attackers forge log correlation. They are accepted only when
`TRUST_REQUEST_ID_HEADER=true` (a proxy that overwrites the header is in front) and only if they match
`^[A-Za-z0-9._:-]{8,128}$`.

### 5.4 Plugins
See §3.4. The architecture deliberately separates "declarative" extensions (data validated by core),
"sandboxed" code (isolated process, capability-checked RPC) and "trusted" code (in-process, explicit
administrator approval). The UI and documentation must never present trusted plugins as sandboxed.

## 6. Residual risks (accepted or open)

| Id | Risk | Status |
|---|---|---|
| R-01 | Zero-day in a pinned dependency or the Node.js runtime | Accepted; mitigated by audit gating, minimal dependencies and prompt updates |
| R-02 | Administrator approves a malicious trusted plugin | Accepted by design (M6); requires explicit approval and warning |
| R-03 | Same-origin admin and public site (see §5.1) | Accepted for the default topology; separate origin supported |
| R-04 | Admin CSP allows `style-src 'unsafe-inline'` (required by Radix scroll-lock style injection) | Accepted; CSS injection is far lower impact than script injection, and scripts stay `'self'`-only |
| R-05 | The timeout interceptor stops waiting but cannot cancel in-flight work | Mitigated by DB `statement_timeout`; accepted |
| R-06 | Moderate dev-only advisory: `minimatch` via ESLint (GHSA-g3hv-75wg-m249) | Accepted: dev tooling only, never in production images; patterns are authored by us |
| R-07 | API runtime image includes the Prisma CLI (pulled in as an optional peer of `@prisma/client` by pnpm) | Open; the runtime never invokes it. Image slimming tracked for M8 |
| R-08 | ~~No authentication~~ | Resolved in M2 |
| R-09 | The generated setup token is written to the API log (the operator's channel for receiving it) | Accepted: single use, regenerated on every start, useless after installation; set `SETUP_TOKEN` to avoid logging |
| R-10 | Per-account sign-in lockout can be triggered by anyone who knows an email address (denial of service against that account) | Accepted trade-off against password guessing; the window is 15 minutes and the per-IP limit still applies |
| R-11 | ~~Password reset email sent in-process; no SMTP transport~~ | Resolved in M3 (SMTP transport; email produced by a durable, retried job) |
| R-12 | The audit trigger stops the application role, not a database superuser or someone with `ALTER TABLE` rights | Accepted; external log shipping planned for M8 |
| R-13 | The capability registry is cached in memory for 30 s per API process (role grants themselves are read per request) | Accepted; only affects capabilities added by future plugin installs |
| R-14 | Jobs run at least once: after a crash or lock timeout a job may run twice (e.g. a second reset email with a new link) | Accepted; handlers are written to be idempotent, and an older reset link stops working when a new one is issued |
| R-15 | GIF, PDF, audio and video uploads are stored as uploaded (only raster images are re-encoded); a PDF could contain scripts for PDF viewers | Mitigated: served as `attachment` with `nosniff` and a sandboxing CSP; accepted for M3 |
| R-16 | Media is served from the admin's origin by default (`/uploads`) | Mitigated by type allowlist, re-encoding, `nosniff` and `default-src 'none'; sandbox`; a separate media origin via `MEDIA_PUBLIC_BASE_URL` is supported |
| R-17 | Media files are public by URL (unguessable keys, but no access control), including files only referenced by drafts | Accepted (common CMS behaviour); private media is a possible later feature |
| R-18 | Uploads are buffered in memory (up to `MEDIA_MAX_UPLOAD_MB` each) | Mitigated by one file per request, a per-user rate limit (60 per 10 min) and the size limit; streaming uploads are a later improvement |
| R-19 | Public pages are rendered per request (several indexed queries each) and the Delivery API has no application-level rate limit | Open; bounded queries, request timeouts and body limits apply; edge rate limiting and an HTML cache are planned for M7 (performance) |
| R-20 | A preview link is a bearer secret: anyone holding it can read that draft for up to an hour; links cannot be revoked one by one | Accepted; short lifetime, hashed at rest, no referrer, no caching, noindex; trashing the entry or suspending the creator invalidates it |
| R-21 | Users with `seo.manage` (or `appearance.manage` for menus) can send visitors to external http(s) sites | Accepted (authorised users only, as in other CMSs); `javascript:`, `data:`, protocol-relative and credential-bearing URLs are rejected |
| R-22 | Root pages created before M4 whose slug equals a route prefix (e.g. a page called "blog") are shadowed by that section | Accepted; documented in the M4 notes; new pages and prefixes are validated so this cannot be created anymore |

## 7. Security checklist (per change)

- [ ] All new input is validated at runtime with Zod at the transport boundary.
- [ ] Every new protected route declares its required capability (M2+), and an authorisation test covers allow and deny.
- [ ] No new `dangerouslySetInnerHTML`, `eval`, `new Function`, or dynamic `import()` of user-controlled paths.
- [ ] Error responses go through `ApiException` / the global filter; no internal messages reach clients.
- [ ] No secrets, tokens or personal data in logs (extend the redaction list if new headers carry credentials).
- [ ] New outbound HTTP goes through the SSRF-guarded client (M3+).
- [ ] New tables have constraints for their invariants, plus a migration and a drift check.
- [ ] New dependencies are justified, pinned, licence-checked, and do not need install scripts (or are explicitly allowlisted).
- [ ] Security-relevant behaviour is covered by an automated test.
