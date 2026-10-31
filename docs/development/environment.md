# Environment variables

The API validates its environment at startup (`apps/api/src/config/env.schema.ts`) and exits with a list of
offending variable names — never their values — if anything is invalid. Empty values are treated as unset.

## API

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production enables the safety rules below. |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `3000` | Listen port (1–65535) |
| `TRUST_PROXY` | `false` | Trusted reverse-proxy hops (`1`), or a comma-separated list of proxy addresses/subnets (`loopback, 10.0.0.0/8`). `true` is rejected as unsafe. |
| `TRUST_REQUEST_ID_HEADER` | `false` | Accept an inbound `X-Request-Id` (format-validated). Enable only behind a proxy that overwrites the header. |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated exact origins allowed to make credentialed cross-origin requests. Empty means same-origin only. Wildcards are rejected. |
| `REQUEST_BODY_LIMIT` | `1mb` | Maximum JSON body size (`512kb`, `1mb`, …). Larger bodies get 413. |
| `REQUEST_TIMEOUT_MS` | `30000` | Handler time limit (1000–300000). Slower requests get 503 `REQUEST_TIMEOUT`. |
| `SHUTDOWN_DELAY_MS` | `0` | After SIGTERM, keep serving with readiness failing for this long so load balancers drain. |
| `DATABASE_URL` | — (required) | `postgresql://` connection URL used by the running API |
| `MIGRATION_DATABASE_URL` | `DATABASE_URL` | Optional, more privileged role used only by `prisma migrate` |
| `SHADOW_DATABASE_URL` | — | Optional shadow database for `prisma migrate dev` |
| `DATABASE_POOL_MAX` | `10` | Maximum pool connections (1–200) |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | Connection acquisition timeout |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `15000` | PostgreSQL `statement_timeout` for every API connection |
| `REDIS_URL` | — | Optional `redis://` / `rediss://` URL (Valkey or Redis) |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `LOG_FORMAT` | `json` | `json` or `pretty` (development only; needs the dev dependency `pino-pretty`) |
| `OPENAPI_ENABLED` | `true` outside production, `false` in production | Serve Swagger UI and the OpenAPI document at `/api/docs` |
| `HEALTH_CHECK_TIMEOUT_MS` | `2000` | Per-dependency timeout for the readiness probe |
| `PRISMA_MIGRATIONS_DIR` | `apps/api/prisma/migrations` | Where readiness looks for shipped migrations |
| `SESSION_COOKIE_SECURE` | `true` in production, `false` otherwise | Secure (`__Host-`) session cookie; requires HTTPS. Must be `true` in production. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `1440` (24 h) | Session ends after this long without use |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `168` (7 days) | Maximum session lifetime regardless of use |
| `SETUP_TOKEN` | — | One-time setup-wizard token (≥ 24 chars). When unset, a random token is generated and logged at every start until installation completes. |
| `MAIL_TRANSPORT` | `log` outside production, `disabled` in production | `log` (message incl. links in the API log), `file` (JSON files in `MAIL_FILE_DIR`), `disabled`. `log`/`file` are refused in production. SMTP arrives with the job queue (M3). |
| `MAIL_FILE_DIR` | `<tmp>/nexora-mail` | Directory for the `file` transport (files are mode 0600) |
| `MAIL_FROM` | `NEXORA CMS <no-reply@localhost>` | Sender address |

### Production safety rules (`NODE_ENV=production`)

The API refuses to start if:

- `DATABASE_URL` has an empty password or a well-known development password (e.g. the one in `.env.example`);
- `LOG_FORMAT=pretty`;
- any `CORS_ALLOWED_ORIGINS` entry is not `https://`;
- `SESSION_COOKIE_SECURE=false`;
- `MAIL_TRANSPORT` is `log` or `file` (they write reset links to logs or disk).

## Docker Compose

| Variable | Default | Used by |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `nexora` / *(required)* / `nexora` | `postgres`, and the `migrate`/`api` connection strings |
| `POSTGRES_PORT` | `5432` | Host port (bound to 127.0.0.1) |
| `VALKEY_PORT` | `6379` | Host port (bound to 127.0.0.1) |
| `APP_PORT` | `8080` | Host port of the admin/edge container in the `app` profile |

## Tests

| Variable | Default |
|---|---|
| `TEST_DATABASE_URL` | `postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_test` (name must end in `_test`) |
| `TEST_REDIS_URL` | unset (cache integration test skipped) |
| `E2E_DATABASE_URL` | `postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_e2e` |

## Admin (Vite)

| Variable | Default | Description |
|---|---|---|
| `NEXORA_API_URL` | `http://127.0.0.1:3000` | API that the Vite dev/preview server proxies `/api` to |
