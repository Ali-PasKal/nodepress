# NEXORA CMS — Architecture Overview

| | |
|---|---|
| Status | Accepted for Milestone 1; revisited at the start of each milestone |
| Scope | Whole system. Sections marked **(M1)** are implemented; everything else is the target design |
| Related | [Security boundaries & threat model](../security/threat-model.md) · [ADRs](./adr/) · [Project status](../status/PROJECT_STATUS.md) |

## 1. Goals and non-goals

**Goals**

- A self-hostable CMS + visual site builder that non-developers can operate without editing code.
- A small number of deployable processes built from one repository (modular monolith), with module
  boundaries strong enough that a module can later be extracted into a service.
- Explicit, versioned extension contracts for themes, widgets and plugins.
- Security as a design input: every protected operation is authorised server-side, all untrusted input is
  validated at runtime, and extension code is never trusted by default.

**Non-goals (for now)**

- Multi-tenancy. The data model reserves room for it (see §6.3) but it is not implemented.
- Running WordPress/PHP plugins or Elementor layouts. WordPress import (M7) converts content only.
- A hosted SaaS control plane.

## 2. System context

```
                    ┌──────────────────────────── Operator's infrastructure ───────────────────────────┐
                    │                                                                                  │
  Visitors ──HTTPS──►  Reverse proxy / TLS  ──/───────────► site-runtime (SSR, read-only)  ─┐           │
                    │  (Caddy/nginx/Traefik)                                                │ Delivery  │
  Editors  ──HTTPS──►                      ──/admin/──────► admin (static SPA)              │ API       │
  & admins          │                      ──/api/────────► api (NestJS) ◄──────────────────┘           │
                    │                                         │   │   │                                │
                    │                                         │   │   └──► object storage (S3 / local) │
                    │                                         │   └──────► Redis-compatible (optional)  │
                    │                                         └──────────► PostgreSQL (system of record)│
                    │                                worker (same codebase as api, no HTTP) ──┘         │
                    └──────────────────────────────────────────────────────────────────────────────────┘
```

| Process | Responsibility | Status |
|---|---|---|
| `apps/api` | Authenticated management API, public Delivery API, OpenAPI, migrations, `/uploads` file serving | **M1–M4** (identity M2; content, media, jobs M3; delivery, appearance, menus, redirects M4) |
| `apps/admin` | Admin dashboard and the visual builder, served as static assets under `/admin/` | **M1–M5** (content, media, terms, content types, jobs in M3; dashboard, appearance, menus, SEO, redirects in M4; visual builder in M5) |
| `apps/site-runtime` | Public site: server-side rendering (React) of published content with the active theme, using only the public Delivery API — no database access, no credentials, no client-side JavaScript | **M4** |
| worker (`apps/api/dist/worker.js`) | Background jobs and recurring tasks from the PostgreSQL queue; embedded in the API by default (`JOBS_WORKER`) | **M3** |

**Single origin by default.** Admin (`/admin/`), API (`/api/`) and the public site (`/`) share one origin in the
default topology so session cookies can be `SameSite=Strict` and CORS is not needed. A **hardened topology**
(admin + management API on a separate origin from the public site) is supported and recommended for
high-value sites because it removes the public site from the admin's same-origin trust zone. See the threat
model, risk R-03.

## 3. Repository structure

```
apps/
  api/            NestJS modular monolith (management API, delivery API, worker entrypoint later)    [M1]
  admin/          React admin SPA + visual editor shell                                              [M1]
  site-runtime/   Public SSR renderer (Express + React, Delivery API client, SEO head, feeds)      [M4]
packages/
  shared/         Runtime-validated API contracts (Zod) shared by api and clients                    [M1]
  ui/             Design system (Tailwind v4 tokens + shadcn/ui-style components)                    [M1]
  cli/            `nexora` developer CLI                                                             [M1]
  plugin-sdk/     Plugin manifest schema, types, test harness                                        [M6]
  theme-sdk/      Theme types; safe rich-text, shortcode, builder and image components; builder CSS [M4–M5]
  theme-starter/  Starter theme: manifest (plain data, read by the API) + React templates + CSS    [M4]
plugins/          First-party plugins (forms, analytics, backup, …)                                  [M6–M7]
themes/           Further themes (business, editorial)                                               [M7]
infrastructure/
  docker/         Dockerfiles and runtime configs                                                    [M1]
docs/             architecture, security, development, api, status                                   [M1]
```

Packages are only created when they contain working code; the bracketed milestone is when each one is
expected to appear. Dependency direction is strictly downward:

```
apps/*  ──►  packages/{plugin-sdk,theme-sdk,ui}  ──►  packages/shared
plugins/*, themes/*  ──►  packages/{plugin-sdk,theme-sdk,shared}      (never into apps/*)
```

`packages/shared` must stay framework-free (Zod only) so it can be used by the API, the browser and SDKs.
ESLint enforces that packages never import from `apps/*`.

## 4. API internals (modular monolith)

### 4.1 Layers

```
transport      controllers (thin), DTO schemas, guards, interceptors, exception filter
application    services: use cases, transactions, authorisation decisions, domain events
domain         entities/value objects, invariants, policies (no framework imports where practical)
infrastructure Prisma repositories, storage adapters, mailers, queue, outbound HTTP (SSRF-guarded)
kernel         config, logging, database client, request context, security middleware        [M1]
```

Rules:

1. Controllers translate HTTP ⇄ application calls; they contain no business rules and never touch Prisma.
2. Only a module's own repositories access its tables. Other modules call its exported application service
   or react to its domain events. No cross-module Prisma queries.
3. Transport DTOs (validated by Zod at the boundary) are distinct from domain models and from Prisma types.
4. Every multi-step state change runs in a single database transaction; side effects (email, webhooks,
   cache purge) are enqueued via a transactional outbox, not executed inline.

### 4.2 Planned modules

| Module | Owns | Milestone |
|---|---|---|
| kernel: `config`, `database`, `logging`, `security` | env validation, Prisma client, pino, headers/CORS/limits | **M1** |
| `health`, `system` | liveness/readiness, installation state | **M1** |
| `auth`, `account`, `security` | sessions, credentials, password reset, CSRF, rate limits, access guard | **M2** |
| `users`, `roles` | users, roles, capabilities, role assignments, escalation rules | **M2** |
| `audit` | append-only audit events | **M2** |
| `setup`, `settings`, `sites` | installation wizard (one-shot), site settings, default site | **M2** |
| `content` | content types and custom fields, taxonomies and terms, entries (posts/pages/custom), status workflow, scheduling, trash, revisions, content policy | **M3** |
| `media` | uploads (content sniffing, re-encoding), variants job, usage counts, storage drivers (local, S3), `/uploads` serving | **M3** |
| `jobs`, `maintenance`, `mail` | PostgreSQL queue, worker, recurring tasks, cleanup, SMTP | **M3** |
| `appearance` | site settings (identity, language, home page, reading), SEO settings, theme registry and validated theme settings, menus and theme locations | **M4** |
| `redirects` | manual redirects; automatic, flattened 301s when published URLs move | **M4** |
| `delivery` | public read-only API consumed by site-runtime (pages, sitemap, feed, previews); one "publicly visible" predicate | **M4** |
| `builder` | builder documents live on entries (`content` module validates them, `delivery` resolves shortcodes, posts widgets and embeds); global widgets and reusable sections are later work | **M5** |
| `extensions` | plugin registry, lifecycle, capability grants, hook bus | M6 |
| `forms` | form definitions, submissions, retention, export | M7 |
| `import` | WXR parsing, previews, import jobs | M7 |

### 4.3 Cross-cutting request pipeline (M1–M3)

```
Node HTTP server (headers/request timeouts; trust-proxy resolution for req.ip)
 → request id (generated; inbound X-Request-Id only if TRUST_REQUEST_ID_HEADER and well-formed)
 → helmet (per-route CSP: API = `default-src 'none'`; docs UI = self-only)
 → Cache-Control: no-store
 → CORS (only for allowlisted origins; none configured ⇒ same-origin only)
 → JSON body parser with size limit (413 on excess)
 → /uploads/* file handler (public media; strict key validation, ranges, immutable caching) — M3
 → Nest router (URI versioning: /api/v1/…)
   → pino-http access log (request id, method, path without query, status; credentials redacted)
   → access guard: origin check (unsafe methods) → session → policy → CSRF token → capabilities
   → timeout interceptor (503 REQUEST_TIMEOUT after REQUEST_TIMEOUT_MS; uploads: MEDIA_UPLOAD_TIMEOUT_MS)
   → multipart parsing for the upload route only (multer, in memory, one size-limited file)
   → Zod validation pipe
   → controller → application service
   → global exception filter (uniform error envelope; never stack traces or internals; DB unavailable ⇒ 503)
```

## 5. Authentication and authorisation (M2)

- **Sessions** are server-side rows in PostgreSQL. The cookie holds an opaque 256-bit random token; only its SHA-256
  is stored. Cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`; in production `Secure` with the `__Host-` prefix
  (`SESSION_COOKIE_SECURE` is enforced there). Idle (default 24 h) and absolute (default 7 days) expiry; a new
  session on every login (any presented session is revoked: fixation defence) and on password change; revocation
  per session, per user, on suspension and on role change.
- **Passwords**: Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1), transparently rehashed on login if parameters
  change; minimum 12 characters; unknown accounts are verified against a dummy hash to equalise timing.
- **CSRF**: every unsafe request must come from a trusted origin (`Origin` must match `Host` or the CORS allowlist;
  `Sec-Fetch-Site: cross-site` is rejected) — this also covers login and setup. Cookie-authenticated mutations must
  additionally send `X-CSRF-Token`, an HMAC of a fixed label keyed by the session token: bound to the session,
  rotated with it, and never stored.
- **Authorisation** is capability-based (`users.read`, `roles.manage`, …). A global guard is fail-closed: routes must
  declare `@Public()`, `@Authenticated()` or `@RequireCapabilities(...)`, and an integration test inventories every
  route. Capabilities are resolved per request, so role changes apply immediately. Roles are configurable bundles;
  the Super Administrator role has `grants_all`. Escalation rules (subset rule, no self role/status changes, no editing
  one's own role, last active super admin) live in the users and roles services.
- **Rate limiting**: fixed-window counters keyed by hashed subject (IP or email), in Redis when connected and in
  PostgreSQL otherwise.
- **Setup**: a one-time token (generated and logged at startup, or `SETUP_TOKEN`) is required to complete the
  wizard; installation is serialised by an advisory lock and permanently locked afterwards.
- **Audit**: security-relevant changes write an `audit_events` row in the same transaction; a trigger rejects
  `UPDATE`/`DELETE`.

## 6. Data architecture

### 6.1 Storage

- **PostgreSQL** is the system of record (content, users, sessions, jobs, audit). Prisma 7 with the `pg`
  driver adapter; all queries parameterised. Raw SQL only through `Prisma.sql` tagged templates.
- **Migrations** are Prisma migrations committed to `apps/api/prisma/migrations`. CI applies them to an empty
  database and fails on drift between `schema.prisma` and the migration history. Constraints that Prisma cannot
  express (e.g. `CHECK`) are added in migration SQL and covered by tests.
- Migrations can run with a separate, more privileged connection (`MIGRATION_DATABASE_URL`) so the runtime
  role can be restricted to DML only.
- **Object storage** behind a `StorageDriver` interface with local-disk and S3-compatible drivers (M3). Storage
  keys are generated server-side (`YYYY/MM/<random>/<ascii-name>.<ext>`) and validated again when serving; only
  the display name comes from the uploaded file name. Local storage needs a persistent volume shared by the API
  and the worker.
- **Redis-compatible store** (Valkey in the dev stack, for licensing reasons) is optional: cache, distributed
  rate-limit counters. The system must remain correct without it.

### 6.2 Modelling principles

- Normalised relational tables for anything that is queried, filtered, joined or constrained (users, roles,
  entries, terms, media, menus, redirects, submissions).
- `jsonb` only for genuinely document-shaped data: versioned editor documents, validated plugin/theme
  settings, custom-field values validated against a registered schema. Every JSON column has a schema
  version and is validated on write.
- Revisions are immutable snapshot rows referencing the entry, written on every save that changes content and
  bounded per entry (`CONTENT_REVISIONS_LIMIT`). The entry row holds the current content; restoring a revision is a
  new save. (Publishing a specific revision while editing a newer draft is a possible later refinement.)
- Trash for entries is a separate `trashed_at` flag (status is preserved), purged after a retention period;
  ephemeral data (sessions, tokens, finished jobs) is hard-deleted by the maintenance job.
- Hierarchical entries store a materialised `path` (`about/team`), unique per site and content type, updated for
  all descendants when an ancestor moves or is renamed.
- Rich text is stored as validated ProseMirror JSON, never as HTML.
- UUIDv7 primary keys (time-ordered, not enumerable) exposed in the API; no sequential IDs in URLs.

### 6.3 Multi-site readiness

Not implemented, but avoided lock-in: site-scoped tables (content, media, menus, themes, plugin settings) will
carry a `site_id` foreign key from the first migration that introduces them, with a single default site row.
Users are global; role assignments are per site. Cache keys, storage keys and job payloads will include the
site id. Enabling real multi-tenancy later requires a request-scoped site resolver and cross-tenant
authorisation tests — not a schema rewrite.

## 7. Content rendering and the visual builder (M4–M5)

**M4 (implemented).** The site runtime resolves each request path through the Delivery API
(`GET /api/v1/delivery/page?path=…`), which returns the site data (identity, SEO defaults, validated theme
settings, menus) and a route: home (latest posts or a static page), entry, archive (content type or term),
redirect or not found. Only publicly visible content is returned: status `published`, not trashed, publication
time reached, public content type, and every ancestor published. Rich text is rendered from the stored
ProseMirror JSON as React elements by the theme SDK (no HTML strings); the runtime owns the document head
(titles, description, canonical, Open Graph, JSON-LD, robots), escapes everything it writes, and sends a CSP
without any script source. Theme settings reach the page as CSS custom properties in a stylesheet whose URL
carries the (re-validated) values, so pages contain no inline styles or scripts. Pages are rendered per request
with ETags (`Cache-Control: max-age=0, must-revalidate`); an HTML cache is a later performance task.

**M5 (implemented).** Entries of content types with `hasBuilder` (pages by default) can be laid out in the visual
builder instead of the rich-text editor (`entries.editor` = `builder`, document in `entries.builder`):

- **Document.** A typed, versioned JSON tree with a fixed depth: sections (boxed or full width) → columns (width per
  breakpoint, vertical alignment) → widgets (heading, text, image, button, spacer, divider, video, posts, shortcode,
  HTML embed). Elements have stable 8-character ids. One Zod schema (`packages/shared/src/contracts/builder.ts`)
  validates documents in the admin and the API, with size and count limits; each document carries a
  `schemaVersion`, `upgradeBuilderDocument` migrates old versions, newer versions are refused. Widget types are a
  closed discriminated union, so unknown widgets cannot be stored. No HTML or JavaScript is stored except the code
  of HTML embed widgets.
- **Styles.** Typed values only (hex colours, bounded integers, enums) per breakpoint; `compileBuilderCss` turns
  them into rules scoped by `.nx-el-<id>` and re-checks every value. Tablet and mobile values are container queries
  on the builder root (`@container nxb (max-width: 1024px | 640px)`), each breakpoint inheriting from the larger
  one, so the editor's device preview (which resizes a container) and the site behave identically. The site sends
  the compiled CSS as one inline `<style>` allowed by its SHA-256 in the page's CSP (`style-src 'self'
  'sha256-…'`): no `unsafe-inline` and no per-request nonce, so pages stay deterministic for ETags.
- **Rendering.** `@nexora/theme-sdk` renders documents with React (`BuilderContent`, `WidgetView`), with layout
  CSS in `@nexora/theme-sdk/builder.css`. The admin canvas uses the same components and CSS (with placeholders for
  videos, embeds and dynamic data, which the admin CSP does not allow to load), so the canvas matches the site.
- **Shortcodes.** `[name attr="value"]` in rich text and builder text/shortcode widgets. A linear-time parser
  (bounded input and count) produces tokens; a registry of typed definitions (`button`, `recent_posts`, `gallery`,
  `video`, `site_name`, `year`) validates attributes. The Delivery API resolves dynamic ones (latest posts, gallery
  media) from publicly visible content and sends them keyed by the shortcode text; the theme SDK renders every
  shortcode as React elements. Unknown or invalid shortcodes stay literal text (as in WordPress); `[[x]]` escapes.
  Nothing is evaluated: there are no callbacks, expressions or templates.
- **HTML embeds.** The page payload never contains embed code. The site renders an `<iframe sandbox>` pointing at
  `/_embed/{entryId}/{widgetId}` (or the preview equivalent), which the runtime serves with
  `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms` — an opaque origin without access to
  the site's cookies, storage or DOM, even when opened directly. (A `srcdoc` iframe would inherit the page's
  script-free CSP and could not run the snippets embeds are for.) Saving embeds requires `content.embed_html`.
- **Editor.** `apps/admin/src/features/builder`: a full-screen route with a widget library, canvas, navigator and
  properties panel; drag and drop via `@dnd-kit` (pointer, touch and keyboard sensors, plus move up/down buttons);
  an undo/redo history of whole documents in a zustand store (quick edits of one field merge into one step); pure
  immutable document operations (`document-ops.ts`); saving through the existing optimistic concurrency,
  revisions, publishing and preview links.

## 8. Themes and plugins (M4, M6)

**Themes (M4).** A theme is a code package shipped with the application: a manifest (plain data — settings with
types and defaults, menu locations) and React templates rendered by the site runtime. The API imports only the
manifest, to validate settings (`buildThemeSettingsSchema`) and to resolve stored values leniently
(`resolveThemeSettings`: stale values fall back to defaults). Because themes are code, installing third-party
themes is part of the extension trust model (M6) and not offered in M4. The M5 builder document model makes it
possible for templates to become declarative data later, so that untrusted themes need no code at all.

**Plugins** — the manifest is metadata, not a security boundary. Three trust tiers:

| Tier | What it can do | How it runs |
|---|---|---|
| Declarative | Widgets composed of existing primitives, settings pages, content types, templates | Data only, validated by core |
| Sandboxed (third-party) | Hooks, routes, jobs via a capability-scoped RPC API | Separate isolated process with resource limits and no direct DB/FS/network; every call checked against granted capabilities |
| Trusted (first-party / explicitly approved) | Anything the core can do | In-process NestJS module; requires an administrator to approve it as trusted code with a clear warning |

Plugin admin UIs run in sandboxed iframes on a separate origin and talk to the admin over a typed
`postMessage` bridge; plugin scripts are never injected into the admin origin. Activation runs the plugin's
migrations and registration inside a transaction and records a lifecycle state machine
(`installed → validated → active ⇄ inactive → uninstalled`, plus `failed`) so a failed activation rolls back.

## 9. Operations

- Configuration only via environment variables, validated at startup by a Zod schema; the process refuses to
  start with invalid or production-unsafe configuration (e.g. development credentials, wildcard CORS).
- Structured JSON logs (pino) with a request id on every line; `authorization`, `cookie` and `set-cookie`
  are redacted.
- `GET /api/v1/health/live` (process up) and `GET /api/v1/health/ready` (database reachable, no pending or failed
  migrations, optional Redis). Readiness reports 503 while shutting down so load balancers drain first.
- Containers run as non-root, with health checks; migrations run as a separate one-shot step before the API.
- Background jobs (M3): a PostgreSQL table claimed with `FOR UPDATE SKIP LOCKED`; jobs are enqueued inside the
  transaction of the change that needs them and workers are woken by `LISTEN/NOTIFY` (polling as fallback).
  Execution is at-least-once with exponential backoff; jobs end in `dead` after their last attempt and can be
  retried from the admin. Recurring tasks (scheduled publishing every minute, maintenance and trash purge hourly)
  are deduplicated per time slot across workers. Workers record heartbeats, shown on the jobs page.
- Backups (M6/M8): logical PostgreSQL dumps + object-storage snapshot, with automated restore verification
  before backups are reported as working.

## 10. Technology choices (pinned in lockfile)

| Area | Choice | Note |
|---|---|---|
| Runtime | Node.js ≥ 22.22 (22/24 LTS recommended; 23.6+ verified), pnpm 10 workspaces | CI tests 22, 23.7 and 24 |
| Language | TypeScript 6.0 (strict) | TS 7 is not yet supported by typescript-eslint |
| API | NestJS 12 (ESM) on Express 5 | URI-versioned REST, OpenAPI via `@nestjs/swagger` |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Rust-free client, generated into the API source tree |
| Validation | Zod 4 | Single schema language for env, DTOs, documents, manifests |
| Logging | pino via `nestjs-pino` | |
| Admin | React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, Zustand 5 | shadcn/ui-style components in `packages/ui` |
| Tests | Vitest 5, React Testing Library, Playwright, Supertest | Integration tests use a real PostgreSQL |

Decisions with lasting consequences are recorded as ADRs in [`adr/`](./adr/).
