# Getting started (local development)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `^22.22.0 \|\| >=23.6.0`, 64-bit (`.nvmrc` pins 22.23.4) | 22 and 24 LTS are recommended and tested in CI. Node 23.6+ works (CI tests 23.7.0); some tools declare odd releases unsupported, so pnpm prints engine warnings there. |
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

### First sign-in: the setup wizard

A fresh instance opens the **setup wizard** at <http://localhost:5173/admin/>. It asks for the site name, base URL,
your administrator account and a **one-time setup token**, which the API prints at startup:

```text
NEXORA is not installed yet. Open /admin/setup and enter this one-time setup token: …
```

(Set `SETUP_TOKEN` in `.env` to choose it yourself.) Once installed, the wizard is permanently disabled.

In development, emails are written to the API log (`MAIL_TRANSPORT=log`); set `MAIL_TRANSPORT=file` to get one
JSON file per email in `MAIL_FILE_DIR` instead, or point `SMTP_HOST`/`SMTP_PORT` at a local mail catcher with
`MAIL_TRANSPORT=smtp` and `SMTP_REQUIRE_TLS=false` (development only).

### Content, media and background jobs

- **Content:** Posts and Pages are built in; define more under *System → Content types* (custom fields and
  taxonomies). Categories and Tags are managed under *Content*.
- **Media** is stored in `apps/api/storage/uploads` by default (ignored by git). Set `MEDIA_STORAGE=s3` and the
  `S3_*` variables to use any S3-compatible store. Files are served at `/uploads/...`; the Vite dev server proxies
  that path to the API.
- **Background jobs** (emails, image variants, scheduled publishing, cleanup) run inside the API process by default
  (`JOBS_WORKER=embedded`). To run them separately, start the API with `JOBS_WORKER=off` and run
  `pnpm --filter @nexora/api run start:worker` (after a build). *System → Background jobs* shows the queue,
  failures and worker heartbeats.

Locked out? `pnpm nexora user reset-password --email you@example.com` sets a temporary password (printed once)
and signs the account out everywhere.

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

- Install the **64-bit (x64)** Node.js installer (22 or 24 LTS recommended; 23.6+ also works), not the 32-bit one: Tailwind, lightningcss and Vite's bundler ship no 32-bit Windows binaries. Check with `node -p "process.arch"` (must print `x64` or `arm64`).
- Install pnpm: `npm install -g pnpm@10.28.0` (no administrator rights needed), or `corepack enable` from an **administrator** PowerShell. Do not use `npm install` in the repository: npm does not support pnpm's `workspace:` protocol.
- If PowerShell refuses to run `pnpm` ("running scripts is disabled on this system"), run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call `pnpm.cmd` instead.
- Always invoke the CLI as `pnpm nexora …` (pnpm passes its own location to the CLI, so no shell or `.cmd` shim is needed).
- Clone after installing Git with default settings; `.gitattributes` keeps LF line endings in the working tree.
- **Without Docker:** install PostgreSQL 16 or 17 for Windows (the EDB installer includes `psql`), create the development role and database, comment out `REDIS_URL` in `.env` (the cache is optional), then run `pnpm nexora dev --no-infra`:

  ```bash
  psql -U postgres -c "CREATE ROLE nexora LOGIN PASSWORD 'nexora_dev_password' CREATEDB;" -c "CREATE DATABASE nexora OWNER nexora;"
  ```

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
| `nexora user reset-password --email <email>` | Account recovery: temporary password, all sessions revoked, audited |
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
| End-to-end (Playwright: setup wizard, then desktop 1280, tablet 768, mobile 375) | `pnpm test:e2e` | PostgreSQL; **recreates** the `nexora_e2e` database, then builds and starts the API and admin |

- API integration tests **recreate the `public` schema** of `TEST_DATABASE_URL` and refuse to run unless the database name ends in `_test`.
- Set `TEST_REDIS_URL` to also run the cache integration test.
- Set `TEST_S3_ENDPOINT` to also run the media tests against S3 storage, using any S3-compatible server with a bucket
  named `nexora-test`, for example:
  `docker run -d -p 9090:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=nexora-test adobe/s3mock:4.6.0`
  then `TEST_S3_ENDPOINT=http://127.0.0.1:9090 pnpm test`.
- The Compose PostgreSQL service creates `nexora_test` and `nexora_e2e` on first start (`infrastructure/docker/postgres/init`). If your volume predates that script: `docker compose exec postgres createdb -U nexora nexora_test`.
- Playwright uses Chromium: run `pnpm --filter @nexora/admin exec playwright install chromium` once.

## Production-like stack in containers

```bash
POSTGRES_PASSWORD='use-a-long-random-value' docker compose --profile app up --build
```

This builds and runs `migrate` (one-shot), `api` (`NODE_ENV=production`, `JOBS_WORKER=off`), `worker` (background
jobs) and `admin` (nginx serving `/admin/` and proxying `/api/` and `/uploads/`) at <http://127.0.0.1:8080/admin/>.
Uploaded media lives in the `media-data` volume, shared by `api` and `worker`. Mail is disabled until you set
`SMTP_HOST` (and usually `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`); TLS is required. Because the API runs in production mode it **refuses
to start with the development password** from `.env.example`. If your `postgres-data` volume was initialised
with the development password, either change it in PostgreSQL (`ALTER ROLE nexora PASSWORD '…'`) or
recreate the volume (`docker compose down -v` deletes all local data).

Behind a TLS-intercepting proxy, pass its CA as a BuildKit secret (it is never stored in an image layer):
`docker build --secret id=extra_ca,src=/path/to/ca.pem …`.

## Troubleshooting

- **`DATABASE_URL: is required`** on API start: create `.env` (`cp .env.example .env`) or export the variable.
- **Readiness shows migrations "Down / N pending"**: run `pnpm nexora migrate deploy`.
- **Port 5432 already in use**: set `POSTGRES_PORT` in `.env` and update `DATABASE_URL` to match.
