# NEXORA CMS

An extensible, self-hostable content management system and visual website builder, built with
TypeScript, NestJS, PostgreSQL and React.

> **Status: Milestone 3 of 8 (content, media and background jobs).** The foundation, identity and access
> control, the content model (posts, pages, custom content types with custom fields, categories, tags and custom
> taxonomies, revisions, scheduling, trash), the media library and a durable job queue with SMTP mail are in place.
> The public site, themes, the visual editor and plugins are **not implemented yet**: content is managed and stored,
> not yet published to visitors. See [`docs/status/PROJECT_STATUS.md`](docs/status/PROJECT_STATUS.md) for exactly
> what works and what does not.

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
- **Admin** (`apps/admin`, React 19 + Vite 8 + Tailwind 4): setup, sign-in, users, roles, audit log, profile,
  content lists and editor, media library, terms, content type builder, background jobs, command palette (Ctrl+K),
  in a responsive dashboard shell served under `/admin/` behind a strict Content Security Policy.
- **Design system** (`packages/ui`), **shared contracts** (`packages/shared`), and the **`nexora` CLI** (`packages/cli`).
- **Docker Compose** dev services (PostgreSQL 17, Valkey 8) and a production-like profile (migrate, API, worker,
  admin/nginx).
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
| `pnpm nexora dev [--no-infra]` | Start services, apply migrations, run the API and admin in watch mode |
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
packages/shared    Runtime-validated API contracts (Zod)
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
