# Getting started (local development)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22.22 (`.nvmrc` pins 22.23.4) | Required by React Router 8 and Vite 8 |
| pnpm | ≥ 10.28 | `corepack enable` picks up the version pinned in `package.json` |
| Docker + Compose v2 | recent | Optional, but the easiest way to run PostgreSQL and Valkey |

## First run

```bash
pnpm install
```

```bash
pnpm nexora dev
```

`nexora dev`:

1. creates `.env` from `.env.example` if it is missing (development values only);
2. starts PostgreSQL 17 and Valkey 8 with `docker compose up --detach --wait`;
3. builds `@nexora/shared` and applies database migrations;
4. runs the API (`http://localhost:3000`, tsc watch + restart), the admin (`http://localhost:5173/admin/`, Vite) and the shared-contracts compiler in watch mode.

Without Docker, provide PostgreSQL yourself, point `DATABASE_URL` at it, and run `pnpm nexora dev --no-infra`.

Check your setup at any time:

```bash
pnpm nexora doctor
```

Useful URLs while `nexora dev` is running:

- Admin: <http://localhost:5173/admin/>
- API readiness: <http://localhost:3000/api/v1/health/ready>
- API docs (Swagger UI): <http://localhost:3000/api/docs/> (the raw document is at `/api/docs/openapi.json`)

## Windows

The toolchain works on Windows 10/11 (PowerShell) with Docker Desktop:

- Install Node.js ≥ 22.22 and Git, then run `corepack enable` once from an **administrator** PowerShell so the pinned pnpm version is used.
- Always invoke the CLI as `pnpm nexora …` (pnpm passes its own location to the CLI, so no shell or `.cmd` shim is needed).
- Clone after installing Git with default settings; `.gitattributes` keeps LF line endings in the working tree.
- If a local PostgreSQL Windows service already uses port 5432, either stop it or set `POSTGRES_PORT` (and the port in `DATABASE_URL`) in `.env`.

## CLI reference

Every command below is implemented in `packages/cli`. Run `pnpm nexora help` for the same list.

| Command | What it does |
|---|---|
| `nexora dev [--no-infra]` | Start services, apply migrations, and run the API, admin and shared package in watch mode |
| `nexora build` | `pnpm -r run build` (shared → API → admin) |
| `nexora test [--e2e]` | Unit and integration tests for all packages, or the Playwright suite |
| `nexora lint` | ESLint (zero warnings) and the Prettier check |
| `nexora typecheck` | Strict TypeScript checks for every package |
| `nexora migrate deploy` | Apply pending migrations |
| `nexora migrate status` | Show migration status |
| `nexora migrate check` | Fail if the database schema differs from `schema.prisma` (drift) |
| `nexora migrate dev [--name x]` | Create a migration from `schema.prisma` changes (refused when `NODE_ENV=production`) |
| `nexora migrate reset --force` | Drop and recreate the database (refused when `NODE_ENV=production`) |
| `nexora doctor` | Check Node, pnpm, Docker, `.env`, and database/cache connectivity |

The equivalent root `package.json` scripts (`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm format`, `pnpm test:e2e`, `pnpm db:migrate`, `pnpm db:check-drift`, `pnpm audit:prod`) work too.

## Database workflow

- The schema lives in `apps/api/prisma/schema.prisma`; migrations in `apps/api/prisma/migrations/`.
- Change the schema, then run `pnpm nexora migrate dev --name describe_change`, and commit the generated SQL.
- Constraints Prisma cannot express (e.g. `CHECK`) go into the migration SQL by hand, with a test.
- CI applies all migrations to an empty database and runs the drift check; a migration that does not reproduce `schema.prisma` fails the build.
- The Prisma client is generated into `apps/api/src/generated/prisma` (git-ignored) by `prisma generate`, which the API's `build`, `typecheck` and `test` scripts run automatically.

## Tests

| Suite | Command | Needs |
|---|---|---|
| Shared contracts, UI, admin (Vitest, jsdom) | `pnpm test` | — |
| API unit + integration (Vitest + Supertest) | `pnpm test` | PostgreSQL; database `nexora_test` |
| CLI (node:test) | `pnpm test` | — |
| End-to-end (Playwright: desktop 1280, tablet 768, mobile 375) | `pnpm test:e2e` | PostgreSQL; builds and starts the API and admin itself |

- API integration tests **recreate the `public` schema** of `TEST_DATABASE_URL` and refuse to run unless the database name ends in `_test`.
- Set `TEST_REDIS_URL` to also run the cache integration test.
- The Compose PostgreSQL service creates `nexora_test` and `nexora_e2e` on first start (`infrastructure/docker/postgres/init`). If your volume predates that script: `docker compose exec postgres createdb -U nexora nexora_test`.
- Playwright uses Chromium: run `pnpm --filter @nexora/admin exec playwright install chromium` once.

## Production-like stack in containers

```bash
POSTGRES_PASSWORD='use-a-long-random-value' docker compose --profile app up --build
```

This builds and runs `migrate` (one-shot), `api` (`NODE_ENV=production`) and `admin` (nginx serving `/admin/` and
proxying `/api/`) at <http://127.0.0.1:8080/admin/>. Because the API runs in production mode it **refuses
to start with the development password** from `.env.example`. If your `postgres-data` volume was initialised
with the development password, either change it in PostgreSQL (`ALTER ROLE nexora PASSWORD '…'`) or
recreate the volume (`docker compose down -v` deletes all local data).

Behind a TLS-intercepting proxy, pass its CA as a BuildKit secret (it is never stored in an image layer):
`docker build --secret id=extra_ca,src=/path/to/ca.pem …`.

## Troubleshooting

- **`DATABASE_URL: is required`** on API start: create `.env` (`cp .env.example .env`) or export the variable.
- **Readiness shows migrations "Down / N pending"**: run `pnpm nexora migrate deploy`.
- **Port 5432 already in use**: set `POSTGRES_PORT` in `.env` and update `DATABASE_URL` to match.
