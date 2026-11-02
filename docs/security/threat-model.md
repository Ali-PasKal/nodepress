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
  - Implemented (M5): builder pages add exactly one inline stylesheet, allowed by its SHA-256 in the page CSP (no `unsafe-inline`, no nonce); its rules are compiled only from typed, re-checked values (hex colours, bounded integers, enums). Dynamic shortcodes and posts widgets are resolved from publicly visible content only (same predicate), at most 20 per entry; HTML embed code is never part of the page payload.
  - Planned (M7): form spam mitigation (honeypot + rate limits + optional challenge), server-side validation.

### 3.2 Authenticated content editors (Author, Contributor, Editor)
- **Goals (malicious or compromised account):** stored XSS through rich text or HTML embeds to hijack an administrator's session; privilege escalation; editing or deleting other users' content.
- **Mitigations:**
  - Implemented (M2): capability-based authorisation on every route via a global, fail-closed guard (a route without a declared policy is refused, and a test inventories every route); privilege-escalation rules (no granting unheld capabilities, no managing more privileged users, no self role/status changes, no editing one's own role, last active Super Administrator protected); role and status changes revoke the target's sessions; append-only audit log.
  - Implemented (M3): one content policy for own vs. others' entries, live content and publishing rights, tested for every built-in role (including a mutation check that the tests catch a weakened rule); entries a user may not see return 404.
  - Implemented (M3): rich text is stored as ProseMirror JSON validated against an allowlist (no HTML, no unknown nodes or marks, link targets limited to http(s)/mailto/tel/same-site, images limited to `/uploads/` or http(s)); nesting depth is checked before parsing; the admin renders stored content as React elements, re-checking URLs.
  - Implemented (M4): the public renderer (theme SDK) emits only the allowlisted rich-text constructs as React elements and re-checks link and image URLs; the public pages' CSP allows no scripts, so injected markup cannot execute.
  - Implemented (M5): builder documents are validated by one closed schema in the admin and the API (fixed depth, size and count limits, unknown widgets and properties rejected, URLs checked as in rich text, styles typed — never raw CSS). Shortcodes are a registry of typed definitions rendered as React elements: nothing is evaluated, attributes are schema-validated (URLs, ids, enums, bounded numbers), and unknown or invalid shortcodes stay literal text. HTML embeds need the `content.embed_html` capability (administrator, editor; changes to existing embeds are checked too) and run only in a document served with `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms` — an opaque origin with no access to the site's or the admin's cookies, storage or DOM, also when the embed URL is opened directly. The admin never renders embed code (the canvas shows a placeholder).
  - Implemented (M1): admin CSP has `script-src 'self'` with no inline scripts (enforced by an E2E test that fails on any CSP violation).

### 3.3 Administrators
- **Goals (compromised account or malicious insider):** install a malicious plugin, exfiltrate data, read secrets, persist access.
- **Mitigations:**
  - Planned: re-authentication for sensitive actions (M2); audit log of privileged actions (M2); plugins require explicit approval as trusted code, with sandboxing for third-party plugins (M6); secrets are never returned by the API once stored (M2+).
  - Residual: an administrator who approves a malicious *trusted* plugin can compromise the instance. This is inherent to running server-side extensions in-process and is documented to administrators.

### 3.4 Malicious plugins (M6)
- **Goals:** read secrets or the database directly, make outbound requests, inject script into the admin or the public site, persist backdoors, exhaust resources.
- **Mitigations (implemented, M6):**
  - Third-party code runs **only** in a sandbox: each active plugin has its own child process running QuickJS compiled to WebAssembly. Plugin code sees no Node.js APIs (no `require`, filesystem, network, processes, timers or host globals); a fresh engine runtime and context per call, so no state survives between calls or visitors.
  - The child process starts with an **empty environment** (no database URL, secrets or proxy settings) and Node's permission model: reads only from its own package and the engine's packages, no writes, no child processes, workers, native addons or WASI, no code generation from strings. Verified by a probe test that runs with the same flags.
  - **Resource limits** on three layers: engine deadline (interrupt handler) and stack limit; a hard cap on the engine's WebAssembly memory (measured: QuickJS's own memory accounting is unreliable in this build, the memory cap is not); and the parent, which kills a child that overruns its call deadline, validates every message, caps results (256 KB), host calls (50 per call), log lines, storage (16 KB per value, 1 MB per plugin) and outbound requests (60 per minute), and marks a plugin as failed after three crashes in ten minutes.
  - **Capabilities are core-implemented RPC calls** checked against what an administrator granted at activation (exactly the manifest's permissions and hosts; an update asking for more deactivates the plugin until reviewed): `content:read` goes through the public visibility predicate; `http:fetch` goes through the SSRF guard (§4).
  - **Output is data, not markup:** shortcode results must be plain text or rich text that passes the stored-content allowlist; themes render it with the safe renderer and never expand shortcodes inside it. Plugin code never reaches the admin origin (no plugin admin UIs in M6; the README is shown as plain text).
  - **Packages** are parsed by a strict ZIP reader (central directory only; no encryption, ZIP64 or multi-disk; size and count limits checked before inflating; inflate capped at the declared size; CRC verified) and stored in the database — nothing is written to disk. Installation, activation, updates, settings changes and removal require `plugins.manage` (administrators) and are audited. `PLUGINS_ENABLED=false` stops all plugin code.
- **Explicit non-claims:** the sandbox is not a guarantee against every engine or WebAssembly bug. If both the QuickJS engine and V8's WebAssembly sandbox were escaped, the code would run as the child process: without secrets or database credentials and without filesystem writes, but **able to open network connections** (Node's permission model in the supported versions does not restrict the network). There is no in-process "trusted" tier: uploaded code never runs in the API process.

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
| SSRF guard for plugin requests (approved exact hosts, HTTPS on 443, every DNS answer checked against private/reserved ranges, connection pinned to the checked address, no redirects, header/size/time/rate limits) | Implemented (M6) | `extensions/safe-fetch.ts`, `plugin-capabilities.ts`; `safe-fetch.test.ts`, API `plugins.test.ts` |
| Delivery API draft isolation (one visibility predicate + ancestor check), public-field opt-in | Implemented (M4) | `delivery/public-content.ts`, `delivery.service.ts`; `delivery.test.ts` |
| Hashed, expiring preview tokens; private preview responses | Implemented (M4) | `entries.service.ts` (`createPreview`), `delivery.service.ts`, site runtime `app.ts`; `delivery.test.ts`, `app.test.ts` |
| Public pages: CSP without scripts or inline styles, escaped head/JSON-LD/XML, ETags, 503 on API outage | Implemented (M4) | `apps/site-runtime/src/{app,html,seo,xml,themes}.ts`; `app.test.ts`, E2E `public-site.spec.ts` |
| Reserved paths and route prefix collisions; redirect source/target validation; loop detection | Implemented (M4) | `content-model.service.ts`, `entries.service.ts`, `redirects.service.ts`, shared `redirects.ts`; `routes-redirects.test.ts` |
| Theme settings validated against the theme manifest (CSS variable values re-validated by the runtime) | Implemented (M4) | shared `themes.ts`, `site-settings.service.ts`, runtime `themes.ts`; `appearance.test.ts`, `app.test.ts` |
| Builder document schema (closed widget set, typed styles, limits, newer versions refused) shared by admin and API | Implemented (M5) | shared `builder.ts`; `builder.test.ts` (hostile documents), API `builder.test.ts`, admin `document-ops.test.ts` |
| Builder CSS compiled from re-checked typed values; inline style allowed only by SHA-256 in the CSP | Implemented (M5) | shared `compileBuilderCss`; runtime `app.ts`, `html.ts`; `builder.test.ts`, runtime `app.test.ts`, E2E `builder.spec.ts` (no CSP violations) |
| Shortcodes: bounded linear parser, typed registry, server-side resolution from public content, literal fallback | Implemented (M5) | shared `shortcodes.ts`, `delivery.service.ts`, theme-sdk `shortcodes.tsx`; `builder.test.ts`, API `builder.test.ts`, `theme-sdk.test.tsx`, E2E |
| HTML embeds: capability-gated, opaque-origin CSP sandbox, never in page payloads or the admin | Implemented (M5) | `entries.service.ts`, `delivery.service.ts`, runtime `app.ts`; API `builder.test.ts`, runtime `app.test.ts`, E2E `builder.spec.ts` (parent and cookie access blocked) |
| Plugin isolation: QuickJS-in-WebAssembly per call, one child process per plugin with an empty environment and Node's permission model, WebAssembly memory cap, engine deadline, parent watchdog, validated messages, crash limit | Implemented (M6) | `packages/plugin-runtime` (`engine.ts`, `host.ts`, `process.ts`); `engine.test.ts`, `process.test.ts` (confinement probe, watchdog), API `plugins.test.ts` |
| Plugin capabilities checked against administrator grants; quotas; output allowlist; events through the job queue with public data | Implemented (M6) | `extensions/*`; API `plugins.test.ts`, shared `plugins.test.ts`, theme-sdk tests |
| Strict plugin package reader (ZIP limits before inflating, capped inflate, CRC, no encryption/ZIP64; packages stored in the database) | Implemented (M6) | `plugin-runtime/zip.ts`, `package.ts`; `package.test.ts` (zip bomb, tampering, unsafe names) |

## 5. Design decisions with security impact

### 5.1 Same-origin admin by default
Admin (`/admin/`), API (`/api/`) and the public site share one origin, which keeps cookies `SameSite=Strict`
and removes CORS entirely. The trade-off (risk **R-03**): script running on the public site would run in the
admin's origin. Since M4 the public pages' CSP contains no script source at all (`default-src 'none'`), so even
injected markup cannot execute script; content is stored as allowlisted JSON (never HTML), themes are
first-party code, and HTML embeds (M5) run in documents with an opaque origin (CSP `sandbox`). A separate admin origin is supported (via
`CORS_ALLOWED_ORIGINS`) and recommended for high-value sites.

### 5.2 Readiness is public, but minimal and rate-coalesced
Orchestrators need unauthenticated probes. Readiness reveals only coarse up/down states and migration
counts — never hostnames, error messages or versions — and concurrent probes share one result per second.

### 5.3 Inbound correlation ids are opt-in
Accepting client-chosen request ids would let attackers forge log correlation. They are accepted only when
`TRUST_REQUEST_ID_HEADER=true` (a proxy that overwrites the header is in front) and only if they match
`^[A-Za-z0-9._:-]{8,128}$`.

### 5.4 Plugins
See §3.4. ADR 0005's tiers are realised as follows in M6: **sandboxed** code (QuickJS in WebAssembly in a separate,
confined process, capability-checked RPC) is the only way third-party code runs; **declarative** parts of a plugin
(settings, shortcode attribute types, permissions) are manifest data validated by the core; a **trusted**
in-process tier is not offered — first-party functionality ships as core modules, and first-party plugins run
sandboxed like any other. The UI and documentation describe exactly what a plugin can and cannot do.

## 6. Residual risks (accepted or open)

| Id | Risk | Status |
|---|---|---|
| R-01 | Zero-day in a pinned dependency or the Node.js runtime | Accepted; mitigated by audit gating, minimal dependencies and prompt updates |
| R-02 | ~~Administrator approves a malicious trusted plugin~~ | Not applicable since M6: there is no trusted in-process tier; all plugins run sandboxed (see R-26, R-27 for what remains) |
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
| R-23 | Users with `content.embed_html` can put arbitrary third-party code on public pages; inside its sandbox it can show popups, submit forms anywhere, load remote resources and track visitors (e.g. a fake sign-in form) | Accepted (needed for maps, booking and analytics snippets): capability limited to administrators and editors by default, opaque origin (no access to the site, the admin or cookies), popups stay sandboxed, embed URLs are `noindex` and sent without referrer |
| R-24 | Builder styles let authors change the look of their own pages freely within typed values (e.g. hide elements, low-contrast colours) | Accepted; values cannot leave the element's scope or inject CSS, and editors review content through the existing publishing rights |
| R-25 | Dynamic shortcodes and posts widgets add queries to a page view (up to 20 per entry, each bounded: 12 items per shortcode, 24 per posts widget, 24 gallery images) | Open with R-19 (page caching in M7); limits are enforced by the schema and the Delivery API |
| R-26 | A sandbox escape through a bug in QuickJS **and** V8's WebAssembly implementation would run code as the plugin's child process, which can open network connections (Node's permission model does not restrict the network in the supported versions) | Accepted with mitigations: the process has no secrets, database credentials or writable filesystem, reads only the engine's packages, and is restarted on misbehaviour; operators can restrict egress at the network level and switch plugins off (`PLUGINS_ENABLED=false`) |
| R-27 | Within its grants, a plugin decides what its shortcodes show (text, links) and what it sends to its approved hosts (public content, its own settings) — e.g. misleading links on pages that use its shortcode | Accepted (the administrator chooses which plugins to trust and which shortcodes to use); output is limited to allowlisted rich text, links are checked, hosts are approved explicitly |
| R-28 | Plugin shortcodes add work to page views (up to 10 sandbox calls per entry, 2 s budget, results cached 30 s per API process) and each active plugin keeps a process (tens of MB) while in use | Open with R-19 (page caching in M7); idle sandboxes are stopped after 10 minutes |
| R-29 | Plugin settings of type `secret` (e.g. webhook URLs) are stored in the database in plain text | Accepted for M6 (same as other site settings); never returned by the API, passed only to the plugin; encryption at rest is a later improvement |

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
