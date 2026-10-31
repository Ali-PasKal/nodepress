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
| `apps/api` | Authenticated management API, public Delivery API, OpenAPI, migrations | **M1** (foundation, health, system status) |
| `apps/admin` | Admin dashboard and (from M5) the visual editor, served as static assets under `/admin/` | **M1** (shell + system status screen) |
| `apps/site-runtime` | Server-side rendering of published pages using themes + document model | M4 |
| worker (entrypoint in `apps/api`) | Background jobs and scheduled tasks from a PostgreSQL-backed queue | M3/M6 |

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
  site-runtime/   Public SSR renderer                                                                [M4]
packages/
  shared/         Runtime-validated API contracts (Zod) shared by api and clients                    [M1]
  ui/             Design system (Tailwind v4 tokens + shadcn/ui-style components)                    [M1]
  cli/            `nexora` developer CLI                                                             [M1]
  document/       Versioned page document schema, migrations, validators (browser + server)          [M5]
  editor/         Editor state, drag-and-drop, widget controls (React)                               [M5]
  widgets/        First-party widget definitions + renderers                                         [M5]
  plugin-sdk/     Plugin manifest schema, types, test harness                                        [M6]
  theme-sdk/      Theme manifest schema, template types                                              [M4]
plugins/          First-party plugins (seo, forms, redirects, analytics, backup, sitemap, …)         [M6–M7]
themes/           nexora-starter, nexora-business, nexora-editorial                                  [M4, M7]
infrastructure/
  docker/         Dockerfiles and runtime configs                                                    [M1]
docs/             architecture, security, development, api, status                                   [M1]
```

Packages are only created when they contain working code; the bracketed milestone is when each one is
expected to appear. Dependency direction is strictly downward:

```
apps/*  ──►  packages/{editor,widgets,document,plugin-sdk,theme-sdk,ui}  ──►  packages/shared
plugins/*, themes/*  ──►  packages/{plugin-sdk,theme-sdk,document,shared}      (never into apps/*)
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
| `identity` | users, credentials, sessions, password reset, email verification | M2 |
| `access` | roles, capabilities, role assignments, policy evaluation | M2 |
| `audit` | append-only audit events | M2 |
| `setup` | installation wizard (one-shot, locked after install) | M2 |
| `content` | content types, entries (pages/posts/custom), revisions, scheduling, previews | M3 |
| `taxonomy` | taxonomies, terms, assignments | M3 |
| `media` | uploads, variants, usage references, storage adapters | M3 |
| `navigation` | menus and items | M3 |
| `themes` | theme registry, settings, templates, template parts | M4 |
| `delivery` | public read-only API consumed by site-runtime; enforces "published only" | M4 |
| `seo` | metadata, sitemaps, robots, redirects, structured data | M4/M6 |
| `builder` | editor documents, global widgets, reusable sections | M5 |
| `extensions` | plugin registry, lifecycle, capability grants, hook bus | M6 |
| `forms` | form definitions, submissions, retention, export | M7 |
| `import` | WXR parsing, previews, import jobs | M7 |
| `jobs` | PostgreSQL-backed queue, scheduler, worker entrypoint | M3 |

### 4.3 Cross-cutting request pipeline (M1)

```
Node HTTP server (headers/request timeouts; trust-proxy resolution for req.ip)
 → request id (generated; inbound X-Request-Id only if TRUST_REQUEST_ID_HEADER and well-formed)
 → helmet (per-route CSP: API = `default-src 'none'`; docs UI = self-only)
 → Cache-Control: no-store
 → CORS (only for allowlisted origins; none configured ⇒ same-origin only)
 → JSON body parser with size limit (413 on excess)
 → Nest router (URI versioning: /api/v1/…)
   → pino-http access log (request id, method, path without query, status; credentials redacted)
   → [M2] authentication guard → capability guard → CSRF guard for cookie-authenticated mutations
   → [M2] Zod validation pipe
   → timeout interceptor (503 REQUEST_TIMEOUT after REQUEST_TIMEOUT_MS)
   → controller → application service
   → global exception filter (uniform error envelope; never stack traces or internals; DB unavailable ⇒ 503)
```

## 5. Authentication and authorisation (target design, M2)

- Server-side sessions stored in PostgreSQL (optionally cached in Redis). The cookie holds an opaque random
  token; only its SHA-256 hash is stored. Cookies: `HttpOnly`, `Secure` (prod), `SameSite=Strict`, `Path=/`,
  `__Host-` prefix when served over HTTPS on a single origin.
- Session rotation on login and privilege change; idle + absolute expiry; revocation per session and per user.
- Passwords hashed with Argon2id (memory-hard parameters documented and tunable).
- CSRF: synchroniser token bound to the session, required on every state-changing request authenticated by
  cookie, plus `Origin`/`Sec-Fetch-Site` verification.
- Authorisation is capability-based (`content.publish`, `media.delete`, `plugins.manage`, …). Roles are
  configurable bundles of capabilities. Code checks capabilities (and ownership where relevant), never role
  names. Every protected route declares its required capability; a test enumerates routes and fails if any
  protected route lacks a declaration.
- Rate limiting: sliding window keyed by IP + account for login, reset and other sensitive endpoints; Redis
  when available, PostgreSQL fallback otherwise.

## 6. Data architecture

### 6.1 Storage

- **PostgreSQL** is the system of record (content, users, sessions, jobs, audit). Prisma 7 with the `pg`
  driver adapter; all queries parameterised. Raw SQL only through `Prisma.sql` tagged templates.
- **Migrations** are Prisma migrations committed to `apps/api/prisma/migrations`. CI applies them to an empty
  database and fails on drift between `schema.prisma` and the migration history. Constraints that Prisma cannot
  express (e.g. `CHECK`) are added in migration SQL and covered by tests.
- Migrations can run with a separate, more privileged connection (`MIGRATION_DATABASE_URL`) so the runtime
  role can be restricted to DML only.
- **Object storage** behind a `StorageAdapter` interface: S3-compatible in production, local filesystem for
  development only. Storage keys are generated server-side, never derived from user filenames.
- **Redis-compatible store** (Valkey in the dev stack, for licensing reasons) is optional: cache, distributed
  rate-limit counters. The system must remain correct without it.

### 6.2 Modelling principles

- Normalised relational tables for anything that is queried, filtered, joined or constrained (users, roles,
  entries, terms, media, menus, redirects, submissions).
- `jsonb` only for genuinely document-shaped data: versioned editor documents, validated plugin/theme
  settings, custom-field values validated against a registered schema. Every JSON column has a schema
  version and is validated on write.
- Revisions are immutable rows referencing the entry; publishing points the entry at a revision.
- Soft delete (`deleted_at`) for user-facing content; hard delete for ephemeral data (sessions, tokens).
- UUIDv7 primary keys (time-ordered, not enumerable) exposed in the API; no sequential IDs in URLs.

### 6.3 Multi-site readiness

Not implemented, but avoided lock-in: site-scoped tables (content, media, menus, themes, plugin settings) will
carry a `site_id` foreign key from the first migration that introduces them, with a single default site row.
Users are global; role assignments are per site. Cache keys, storage keys and job payloads will include the
site id. Enabling real multi-tenancy later requires a request-scoped site resolver and cross-tenant
authorisation tests — not a schema rewrite.

## 7. Content rendering and the visual builder (M4–M5)

- Pages built in the editor are stored as a **typed, versioned JSON document** (tree of sections, containers,
  widgets with stable ids, responsive overrides). There is no stored HTML or JavaScript in the model.
- The same Zod schema validates documents in the browser and on the server. Each document carries a
  `schemaVersion`; pure migration functions upgrade old documents on read.
- Widgets are registered definitions: `{ id, version, schema, defaults, controls, render }`. The public
  renderer walks the tree and calls the registered renderer, which emits escaped output. Unknown widgets render
  nothing in production and a visible notice in the editor.
- Responsive values resolve desktop → tablet → mobile (each breakpoint inherits from the next larger one unless
  overridden). Styles compile to scoped CSS classes using design-token CSS variables, not inline styles.
- "HTML Embed" is sanitised with an allowlist and rendered inside a sandboxed `iframe` (`srcdoc`, no
  `allow-same-origin`) so it cannot touch the site origin.
- Dynamic data bindings reference a fixed set of named data sources and fields — no expression evaluation.

## 8. Themes and plugins (M4, M6)

**Themes** are declarative packages: manifest + templates expressed in the document model + design tokens +
static assets. A theme cannot run server-side code. Settings are validated against the manifest's schema and
migrated between theme versions by declarative mapping.

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
- Backups (M6/M8): logical PostgreSQL dumps + object-storage snapshot, with automated restore verification
  before backups are reported as working.

## 10. Technology choices (pinned in lockfile)

| Area | Choice | Note |
|---|---|---|
| Runtime | Node.js 22 LTS (≥ 22.22.2) or 24 LTS (≥ 24.15), pnpm 10 workspaces | Intersection of all dependencies' `engines` |
| Language | TypeScript 6.0 (strict) | TS 7 is not yet supported by typescript-eslint |
| API | NestJS 12 (ESM) on Express 5 | URI-versioned REST, OpenAPI via `@nestjs/swagger` |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Rust-free client, generated into the API source tree |
| Validation | Zod 4 | Single schema language for env, DTOs, documents, manifests |
| Logging | pino via `nestjs-pino` | |
| Admin | React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, Zustand 5 | shadcn/ui-style components in `packages/ui` |
| Tests | Vitest 5, React Testing Library, Playwright, Supertest | Integration tests use a real PostgreSQL |

Decisions with lasting consequences are recorded as ADRs in [`adr/`](./adr/).
