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
| `MAIL_TRANSPORT` | `log` outside production; in production `smtp` when `SMTP_HOST` is set, otherwise `disabled` | `smtp`, `log` (message incl. links in the API log), `file` (JSON files in `MAIL_FILE_DIR`), `disabled`. `log`/`file` are refused in production. Mail is sent by background jobs. |
| `MAIL_FILE_DIR` | `<tmp>/nexora-mail` | Directory for the `file` transport (files are mode 0600) |
| `MAIL_FROM` | `NEXORA CMS <no-reply@localhost>` | Sender address (must be a real address when SMTP is used in production) |
| `SMTP_HOST` | — | SMTP server; required when `MAIL_TRANSPORT=smtp` |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | Implicit TLS (usually port 465) |
| `SMTP_REQUIRE_TLS` | `true` | Require STARTTLS when not using implicit TLS; plain-text SMTP is refused in production |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `true` | Verify the server certificate; must stay `true` in production |
| `SMTP_USER` / `SMTP_PASSWORD` | — | SMTP credentials (set both or neither) |
| `JOBS_WORKER` | `embedded` | `embedded`: this API process also runs background jobs. `off`: jobs are only enqueued; run `node dist/worker.js` (or the Compose `worker` service) |
| `JOBS_CONCURRENCY` | `2` | Jobs a worker runs at the same time (1–32) |
| `JOBS_POLL_INTERVAL_MS` | `5000` | Fallback polling interval; workers are normally woken immediately through PostgreSQL `LISTEN/NOTIFY` |
| `JOBS_LOCK_TIMEOUT_MS` | `900000` (15 min) | A running job not finished within this time is treated as abandoned and retried |
| `JOBS_RETRY_BASE_MS` | `15000` | First retry delay; doubles per attempt (±20 % jitter, max 1 h) |
| `JOBS_SHUTDOWN_GRACE_MS` | `8000` | On shutdown, wait this long for running jobs before returning them to the queue |
| `MEDIA_STORAGE` | `local` | `local` (disk) or `s3` (any S3-compatible store) |
| `MEDIA_LOCAL_DIR` | `apps/api/storage/uploads` | Directory for local media storage (a mounted volume in containers) |
| `MEDIA_MAX_UPLOAD_MB` | `25` | Maximum upload size (1–512). Keep the edge proxy's limit (nginx `client_max_body_size` for `/api/v1/media`) above it |
| `MEDIA_UPLOAD_TIMEOUT_MS` | `300000` | Time allowed for an upload request (large files on slow connections) |
| `MEDIA_PUBLIC_BASE_URL` | — | Public URL prefix for media files (CDN or public bucket). Unset: files are served by the API at `/uploads/...`. The admin's CSP must allow this origin for images (`img-src`) if set |
| `S3_BUCKET` | — | Bucket; required when `MEDIA_STORAGE=s3` |
| `S3_REGION` | `us-east-1` | Region |
| `S3_ENDPOINT` | — | Endpoint for S3-compatible services (MinIO, R2, Spaces…) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Credentials (set both, or neither to use the SDK's default credential chain, e.g. an instance role) |
| `S3_FORCE_PATH_STYLE` | `false` | Path-style bucket addressing (most self-hosted S3-compatible servers need `true`) |
| `CONTENT_TRASH_RETENTION_DAYS` | `30` | Trashed entries are deleted permanently after this many days |
| `CONTENT_REVISIONS_LIMIT` | `50` | Revisions kept per entry (oldest are pruned) |

### Production safety rules (`NODE_ENV=production`)

The API refuses to start if:

- `DATABASE_URL` has an empty password or a well-known development password (e.g. the one in `.env.example`);
- `LOG_FORMAT=pretty`;
- any `CORS_ALLOWED_ORIGINS` entry is not `https://`;
- `SESSION_COOKIE_SECURE=false`;
- `MAIL_TRANSPORT` is `log` or `file` (they write reset links to logs or disk);
- SMTP is used without TLS (`SMTP_SECURE=false` and `SMTP_REQUIRE_TLS=false`), with
  `SMTP_TLS_REJECT_UNAUTHORIZED=false`, or with a `MAIL_FROM` at `localhost`.

In every environment the API also refuses incomplete settings: `MAIL_TRANSPORT=smtp` without `SMTP_HOST`,
`MEDIA_STORAGE=s3` without `S3_BUCKET`, and only one half of a credential pair.

## Site runtime (`apps/site-runtime`)

The public site process validates its environment at startup (`apps/site-runtime/src/config.ts`). It holds no
secrets and needs no database access: everything it shows comes from the API's public Delivery endpoints.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `SITE_HOST` | `127.0.0.1` (`0.0.0.0` in the container image) | Listen address |
| `SITE_PORT` | `4321` | Listen port |
| `DELIVERY_API_URL` | `http://127.0.0.1:3000` | Base URL of the NEXORA API (http or https). Only `/api/v1/delivery/*` is used |
| `SITE_API_TIMEOUT_MS` | `5000` | Timeout for each Delivery API request; when the API is slow or down the site answers 503 with `Retry-After` |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

The site must be served from the same origin as the API's `/uploads` (as the Compose nginx and the Vite
dev/preview proxies do), because media URLs are site-relative unless `MEDIA_PUBLIC_BASE_URL` is set.

## Docker Compose

| Variable | Default | Used by |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `nexora` / *(required)* / `nexora` | `postgres`, and the `migrate`/`api` connection strings |
| `POSTGRES_PORT` | `5432` | Host port (bound to 127.0.0.1) |
| `VALKEY_PORT` | `6379` | Host port (bound to 127.0.0.1) |
| `APP_PORT` | `8080` | Host port of the edge (nginx) container in the `app` profile: the public site at `/`, the admin at `/admin/` |
| `MEDIA_MAX_UPLOAD_MB` | `25` | Passed to the `api` and `worker` services |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | unset (mail disabled) | Passed to the `api` and `worker` services |

## Tests

| Variable | Default |
|---|---|
| `TEST_DATABASE_URL` | `postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_test` (name must end in `_test`) |
| `TEST_REDIS_URL` | unset (cache integration test skipped) |
| `TEST_S3_ENDPOINT` | unset (S3 storage tests skipped). An S3-compatible server with bucket `TEST_S3_BUCKET` (default `nexora-test`), e.g. `adobe/s3mock:4.6.0` |
| `E2E_DATABASE_URL` | `postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_e2e` |

## Admin (Vite)

| Variable | Default | Description |
|---|---|---|
| `NEXORA_API_URL` | `http://127.0.0.1:3000` | API that the Vite dev/preview server proxies `/api` and `/uploads` to |
| `NEXORA_SITE_URL` | `http://127.0.0.1:4321` | Site runtime that the Vite dev/preview server proxies every other path outside `/admin/` to |
