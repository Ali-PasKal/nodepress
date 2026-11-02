# NEXORA CMS

An extensible, self-hostable content management system and visual website builder, built with
TypeScript, NestJS, PostgreSQL and React.

> **Status: Milestone 6 of 8 (plugins).** The foundation, identity and access control, the content model, the media
> library, a durable job queue, the public website, the visual page builder with shortcodes, and now **plugins** are
> in place: plugins add shortcodes and react to publishing, and run in an isolated sandbox with only the permissions an
> administrator grants. See [`docs/status/PROJECT_STATUS.md`](docs/status/PROJECT_STATUS.md) for exactly what works
> and what does not.

## What exists today

- **API** (`apps/api`, NestJS 12 + Prisma 7 + PostgreSQL): validated configuration with production safety
  rules, liveness/readiness probes, uniform error envelope, strict security headers, CORS allowlist, request
  limits and timeouts, structured JSON logs with request correlation, and an OpenAPI document generated from
  shared Zod contracts.
- **Identity and access** (M2): setup wizard with a one-time token; Argon2id sign-in with server-side,
  HttpOnly cookie sessions; CSRF protection; rate limiting; deny-by-default capability authorisation; built-in and
  custom roles with privilege-escalation rules; password reset; CLI account recovery; append-only audit log.
- **Content** (M3): built-in Post and Page types plus custom content types with validated custom fields;
  categories, tags and custom taxonomies; a structured rich-text editor (no stored HTML); draft, review, scheduled
  and published states; hierarchical pages; revisions with restore; trash; bulk actions; conflict detection when two
  people edit the same entry; one ownership policy for every role.
- **Media** (M3): uploads identified by their content (not their name), images re-encoded without metadata,
  responsive variants, alt text and captions, local or S3-compatible storage, safe file serving.
- **Background jobs** (M3): a PostgreSQL job queue with retries, recurring tasks (scheduled publishing,
  maintenance), a separate worker process option, SMTP mail with TLS, and an operator view.
- **Public site** (M4, `apps/site-runtime`): server-rendered pages for published content only (home with latest
  posts or a static page, posts, nested pages, custom types, category/tag archives, pagination), built from the
  public Delivery API; a starter theme (responsive, light/dark, right-to-left ready, no client-side JavaScript)
  with validated theme settings; menus; titles, descriptions, canonical URLs, Open Graph, JSON-LD, `sitemap.xml`,
  `robots.txt` and RSS; automatic and manual redirects; one-hour private preview links; a Content Security Policy
  that allows no scripts at all.
- **Visual builder** (M5): a full-screen editor for pages (and any content type that opts in) with sections,
  columns and widgets — heading, text, image, button, spacer, divider, video, posts, shortcode and HTML embed —
  drag and drop (mouse, touch, keyboard), a navigator, per-device styles (desktop, tablet, mobile) with a device
  preview, undo/redo, revisions, publishing and preview links. The canvas uses the same components and CSS as the
  public site. Documents are typed JSON validated in the browser and the API; styles are typed values compiled to
  scoped CSS, allowed on the site by a CSP hash. HTML embeds run in a sandboxed origin and need their own
  capability.
- **Shortcodes** (M5): `[button]`, `[recent_posts]`, `[gallery]`, `[video]`, `[site_name]` and `[year]` in posts,
  pages and builder widgets, with attributes validated per shortcode and dynamic data resolved on the server from
  published content only. Unknown or invalid shortcodes stay visible as text (as in WordPress) and are flagged in
  the editor; `[[name]]` writes a literal `[name]`. Nothing is executed.
- **Plugins** (M6): install from a `.zip` or from NEXORA's own plugins, review the requested permissions,
  configure them with a generated settings form, see their log, update and uninstall. A plugin offers shortcodes
  (usable in posts, pages and the builder) and reacts to publishing. Plugin code runs only in a sandbox — QuickJS in
  WebAssembly, one process per plugin, no environment, files or network of its own — with time and memory limits;
  it can only use its settings, a private storage, published content (`content:read`) and HTTPS requests to approved
  hosts through an SSRF guard (`http:fetch`). Shortcode output must pass the same allowlist as content. First-party
  plugins: Reading time, Related posts, Publish notifications (Slack/Discord). A plugin SDK with a test harness and
  `nexora plugin pack` are included ([developer guide](docs/plugins/README.md)).
- **Admin** (`apps/admin`, React 19 + Vite 8 + Tailwind 4): dashboard, setup, sign-in, users, roles, audit log,
  profile, content lists and editor (with SEO panel, view and preview), media library, terms, content type builder,
  appearance (site identity, reading, theme settings), menus, SEO and redirects, background jobs, command palette
  (Ctrl+K), in a responsive shell served under `/admin/` behind a strict Content Security Policy.
- **Design system** (`packages/ui`), **shared contracts** (`packages/shared`), **theme SDK and starter theme**
  (`packages/theme-sdk`, `packages/theme-starter`), and the **`nexora` CLI** (`packages/cli`).
- **Docker Compose** dev services (PostgreSQL 17, Valkey 8) and a production-like profile (migrate, API, worker,
  site runtime, nginx edge serving the site at `/` and the admin at `/admin/`).
- **CI**: lint, format, typecheck, build, bundle-size budget, unit/integration (with PostgreSQL, Valkey and an
  S3-compatible server), E2E on three viewports, migration drift check, dependency audit, Node 23.7/24
  compatibility, image builds.

## Quick start

Requirements: **64-bit** Node.js ≥ 22.22 (22 or 24 LTS recommended; 23.6+ also works), pnpm ≥ 10.28, and Docker (optional, for PostgreSQL and Valkey).

> Use **pnpm**, not npm: this is a pnpm workspace, and `npm install` fails with
> `Unsupported URL Type "workspace:"`. Install pnpm with `npm install -g pnpm@10.28.0` (or `corepack enable`).

```bash
pnpm install
```

```bash
pnpm nexora dev
```

Then open <http://localhost:5173/admin/>. On first start the API prints a one-time **setup token** to its
log; the setup wizard asks for it before creating the first super administrator. Run `pnpm nexora doctor`
to diagnose your environment.
Full instructions: [`docs/development/getting-started.md`](docs/development/getting-started.md).

## Commands

| Command | Purpose |
|---|---|
| `pnpm nexora dev [--no-infra]` | Start services, apply migrations, run the API, site runtime and admin in watch mode (site at `http://localhost:5173/`, admin at `/admin/`) |
| `pnpm nexora build` | Production build of every package |
| `pnpm nexora test [--e2e]` | Unit and integration tests, or the Playwright end-to-end suite |
| `pnpm nexora lint` / `typecheck` | ESLint + Prettier check / strict TypeScript |
| `pnpm nexora migrate <deploy\|status\|check\|dev\|reset>` | Database migrations (`check` detects schema drift) |
| `pnpm nexora user reset-password --email <email>` | Account recovery: prints a temporary password once and signs the user out everywhere |
| `pnpm nexora doctor` | Environment diagnostics |

## Repository layout

```
apps/api           NestJS API (modular monolith)
apps/admin         Admin dashboard (React SPA, served at /admin/)
apps/site-runtime  Public site (server-side React rendering from the Delivery API)
packages/shared    Runtime-validated API contracts (Zod)
packages/theme-sdk Theme types, safe rendering components, helpers
packages/theme-starter  The starter theme
packages/ui        Design tokens and accessible components
packages/cli       nexora developer CLI
infrastructure/    Dockerfiles, nginx and PostgreSQL init config
docs/              Architecture, ADRs, security, development, API, status
```

## Documentation

- [Architecture overview](docs/architecture/overview.md) and [decision records](docs/architecture/adr/)
- [Security architecture and threat model](docs/security/threat-model.md)
- [Getting started](docs/development/getting-started.md) · [Environment variables](docs/development/environment.md)
- [HTTP API](docs/api/README.md) ([OpenAPI](docs/api/openapi.json))
- [Project status and roadmap](docs/status/PROJECT_STATUS.md)

## Security

NEXORA does not claim to be invulnerable. Its defense-in-depth design, implemented controls, planned
controls and accepted residual risks are documented in the [threat model](docs/security/threat-model.md).
Please report vulnerabilities privately to the maintainers rather than in public issues.

## License

[MIT](LICENSE)
