# NEXORA CMS

An extensible, self-hostable content management system and visual website builder, built with
TypeScript, NestJS, PostgreSQL and React.

> **Status: Milestone 1 of 8 (foundation).** The architecture, tooling, database pipeline, health
> monitoring, admin shell, Docker environment and CI are in place. Content management, authentication,
> the visual editor, themes and plugins are **not implemented yet**. See
> [`docs/status/PROJECT_STATUS.md`](docs/status/PROJECT_STATUS.md) for exactly what works and what does not.

## What exists today

- **API** (`apps/api`, NestJS 12 + Prisma 7 + PostgreSQL): validated configuration with production safety
  rules, liveness/readiness probes (database, migrations, optional cache, graceful drain), installation
  status, uniform error envelope, strict security headers, CORS allowlist, request limits and timeouts,
  structured JSON logs with request correlation, and an OpenAPI document generated from shared Zod contracts.
- **Admin** (`apps/admin`, React 19 + Vite 8 + Tailwind 4): a responsive dashboard shell (collapsible
  sidebar, accessible mobile drawer, dark/light/system themes) with a live system-status screen, served
  under `/admin/` behind a strict Content Security Policy.
- **Design system** (`packages/ui`), **shared contracts** (`packages/shared`), and the **`nexora` CLI** (`packages/cli`).
- **Docker Compose** dev services (PostgreSQL 17, Valkey 8) and a production-like container profile.
- **CI**: lint, format, typecheck, build, unit/integration/E2E tests, migration drift check, dependency audit, image builds.

## Quick start

Requirements: Node.js ≥ 22.22, pnpm ≥ 10.28, and Docker (optional, for PostgreSQL and Valkey).

```bash
pnpm install
```

```bash
pnpm nexora dev
```

Then open <http://localhost:5173/admin/>. Run `pnpm nexora doctor` to diagnose your environment.
Full instructions: [`docs/development/getting-started.md`](docs/development/getting-started.md).

## Commands

| Command | Purpose |
|---|---|
| `pnpm nexora dev [--no-infra]` | Start services, apply migrations, run the API and admin in watch mode |
| `pnpm nexora build` | Production build of every package |
| `pnpm nexora test [--e2e]` | Unit and integration tests, or the Playwright end-to-end suite |
| `pnpm nexora lint` / `typecheck` | ESLint + Prettier check / strict TypeScript |
| `pnpm nexora migrate <deploy\|status\|check\|dev\|reset>` | Database migrations (`check` detects schema drift) |
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
