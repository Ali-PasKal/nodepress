# HTTP API

The machine-readable contract is [`openapi.json`](./openapi.json), generated from the code:

```bash
pnpm --filter @nexora/api run build && pnpm --filter @nexora/api run openapi:export
```

When `OPENAPI_ENABLED` is on (the default outside production), the running API serves Swagger UI at
`/api/docs/` and the document at `/api/docs/openapi.json`.

## Conventions

- **Versioning:** URI-based, `/api/v1/...`. Breaking changes ship under a new version.
- **Format:** JSON request and response bodies only (`application/json`); bodies over `REQUEST_BODY_LIMIT` return 413.
- **Contracts:** response schemas are the Zod schemas in `packages/shared`; clients should validate them at runtime.
- **Caching:** responses default to `Cache-Control: no-store`.
- **Correlation:** every response carries `X-Request-Id`; include it when reporting problems.
- **Errors:** every non-2xx response uses one envelope. Branch on `code`, never on `message`:

  ```json
  { "error": { "code": "NOT_FOUND", "message": "The requested resource was not found.", "requestId": "4b5f…" } }
  ```

  Codes: `BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`,
  `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `REQUEST_TIMEOUT`,
  `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`. Internal details (stack traces, SQL, hostnames) are never included.

## Endpoints (Milestone 1)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/health/live` | public | Liveness: the process is up. No dependency checks. Always 200 while serving. |
| GET | `/api/v1/health/ready` | public | Readiness: database reachable, all shipped migrations applied (none failed), optional cache, not shutting down. 200 for `ok`/`degraded`, 503 for `error`. Results are shared for up to 1 second. |
| GET | `/api/v1/system/status` | public | `{ "installed": boolean }`: whether initial setup has been completed. 503 if the database is unavailable. |

Readiness example:

```json
{
  "status": "ok",
  "checkedAt": "2026-10-31T09:20:06.267Z",
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "migrations": { "status": "up", "pending": 0, "failed": 0 },
    "cache": { "status": "disabled" },
    "shutdown": { "status": "up" }
  }
}
```
