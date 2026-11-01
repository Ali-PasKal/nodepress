# HTTP API

The machine-readable contract is [`openapi.json`](./openapi.json), generated from the code:

```bash
pnpm --filter @nexora/api run build && pnpm --filter @nexora/api run openapi:export
```

When `OPENAPI_ENABLED` is on (the default outside production), the running API serves Swagger UI at
`/api/docs/` and the document at `/api/docs/openapi.json`.

## Conventions

- **Versioning:** URI-based, `/api/v1/...`. Breaking changes ship under a new version.
- **Format:** JSON request and response bodies (`application/json`); bodies over `REQUEST_BODY_LIMIT` return 413. The
  only exception is the media upload, which takes `multipart/form-data` (one `file` part, up to `MEDIA_MAX_UPLOAD_MB`).
- **Concurrency:** entries carry a `version`. Updates must send the version they were based on; a stale version
  returns `409 CONFLICT` instead of overwriting someone else's changes.
- **Rich text:** entry bodies are ProseMirror/TipTap JSON documents restricted to an allowlist (paragraphs, headings
  2–6, lists, quotes, code, rules, images from the media library; bold, italic, underline, strike, code, links with
  http(s)/mailto/tel or same-site targets). Anything else is rejected with `422`; unknown attributes are dropped.
  See `packages/shared/src/contracts/rich-text.ts`.
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

## Authentication

- **Sessions:** `POST /api/v1/auth/login` sets an HttpOnly, `SameSite=Strict` session cookie (`__Host-nexora_session`
  over HTTPS, `nexora_session` in plain-HTTP development). The token is opaque; the server stores only its hash.
- **CSRF:** every state-changing request (`POST`, `PATCH`, `DELETE`) authenticated by the cookie must send
  `X-CSRF-Token` with the `csrfToken` from `GET /api/v1/auth/session` (or the login response). Keep it in memory.
  Unsafe requests from other origins (`Origin` / `Sec-Fetch-Site`) are rejected with `403 CSRF_FAILED`, including
  login and setup.
- **Authorisation:** every non-public route requires a session (`401 UNAUTHENTICATED`) and declares the capabilities
  it needs (`403 FORBIDDEN`). Capabilities are evaluated on every request, so role changes apply immediately.
- **Rate limits:** sign-in (per IP and per account), password reset and setup return `429 RATE_LIMITED` with
  `Retry-After` when exceeded.

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/v1/health/live` | public | Liveness |
| GET | `/api/v1/health/ready` | public | Readiness (200 `ok`/`degraded`, 503 `error`) |
| GET | `/api/v1/system/status` | public | `{ installed }` |
| GET | `/api/v1/setup/status` | public | Wizard checks; only `{ installed: true }` once installed |
| POST | `/api/v1/setup/install` | public + setup token | One-time installation (409 afterwards) |
| POST | `/api/v1/auth/login` | public | Sign in; returns the session payload |
| POST | `/api/v1/auth/logout` | session | Revoke the current session |
| GET | `/api/v1/auth/session` | public | Current session, capabilities, CSRF token — or `{ authenticated: false }` |
| POST | `/api/v1/auth/password-reset/request` | public | Email a reset link (same 202 response for unknown accounts) |
| POST | `/api/v1/auth/password-reset/confirm` | public + token | Set a new password; signs out all sessions |
| GET/PATCH | `/api/v1/account/profile` | session | Own profile |
| POST | `/api/v1/account/password` | session | Change own password (re-verifies; rotates session) |
| GET | `/api/v1/account/sessions` | session | Own active sessions |
| DELETE | `/api/v1/account/sessions/{id}` | session | Revoke one own session |
| POST | `/api/v1/account/sessions/revoke-others` | session | Sign out all other sessions |
| GET | `/api/v1/users` | `users.read` | List users (`search`, `status`, `roleId`, `page`, `pageSize`) |
| POST | `/api/v1/users` | `users.create` | Create a user (role must be within the actor's capabilities) |
| GET | `/api/v1/users/{id}` | `users.read` | Get a user |
| PATCH | `/api/v1/users/{id}` | `users.update` (+ `users.assign_roles` for role changes) | Name, status, role |
| POST | `/api/v1/users/{id}/password` | `users.update` | Set another user's password |
| GET | `/api/v1/users/{id}/sessions` | `sessions.manage` | A user's active sessions |
| POST | `/api/v1/users/{id}/sessions/revoke-all` | `sessions.manage` | Sign a user out everywhere |
| GET | `/api/v1/roles` | `roles.read` | Roles and the capability registry |
| POST | `/api/v1/roles` | `roles.manage` | Create a custom role |
| PATCH | `/api/v1/roles/{id}` | `roles.manage` | Update a role (built-in: capabilities/description only) |
| DELETE | `/api/v1/roles/{id}` | `roles.manage` | Delete an unused custom role |
| GET | `/api/v1/audit-events` | `audit.read` | Audit log (`action` prefix, `actorId`, paging) |
| GET/PATCH | `/api/v1/settings/site` | `system.manage` | Site name and public base URL |
| GET | `/api/v1/content-model` | any content capability | Content types (with custom fields) and taxonomies |
| POST | `/api/v1/content-types` | `content_types.manage` | Create a custom content type |
| PATCH / DELETE | `/api/v1/content-types/{id}` | `content_types.manage` | Update; delete (custom, without entries) |
| POST | `/api/v1/taxonomies` | `content_types.manage` | Create a custom taxonomy |
| PATCH / DELETE | `/api/v1/taxonomies/{id}` | `content_types.manage` | Update; delete (custom; deletes its terms) |
| GET | `/api/v1/taxonomies/{id}/terms` | `content.read`, `content.create`, `content.edit_others` or `terms.manage` | List terms (`search`, paging up to 500) |
| POST | `/api/v1/taxonomies/{id}/terms` | `terms.manage` | Create a term |
| PATCH / DELETE | `/api/v1/terms/{id}` | `terms.manage` | Update; delete (children move up, entries lose it) |
| GET | `/api/v1/entries` | `content.read`, `content.create` or `content.edit_others` | List entries of a type (`type`, `status`, `search`, `authorId`, `termId`, `sort`, paging) with per-status counts; own entries only unless allowed to see all |
| POST | `/api/v1/entries` | `content.create` (+ `content.publish` to publish or schedule) | Create an entry |
| POST | `/api/v1/entries/bulk` | per entry | Publish, revert to draft, trash, restore or delete several entries; reports failures per entry |
| GET | `/api/v1/entries/{id}` | as listing, per entry | Entry with content and the caller's `permissions` |
| PATCH | `/api/v1/entries/{id}` | per entry (content policy) | Update content and/or status; requires `version` |
| POST | `/api/v1/entries/{id}/trash` / `restore` | `content.delete`, per entry | Move to / restore from the trash |
| DELETE | `/api/v1/entries/{id}` | `content.delete`, per entry | Delete a trashed entry permanently (not while it has children) |
| GET | `/api/v1/entries/{id}/revisions` | as entry | Revisions, newest first |
| GET | `/api/v1/entries/{id}/revisions/{revisionId}` | as entry | A revision's full content |
| POST | `/api/v1/entries/{id}/revisions/{revisionId}/restore` | per entry | Restore a revision (saved as a new revision); requires `version` |
| GET | `/api/v1/media` | `media.upload`, `media.manage` or `content.read` | Media library (`search`, `kind`, `mine`, paging) |
| GET | `/api/v1/media/limits` | `media.upload` or `media.manage` | Upload size limit and accepted types |
| POST | `/api/v1/media` | `media.upload` | Upload (`multipart/form-data`: `file`, optional `title`, `altText`) |
| GET | `/api/v1/media/{id}` | as listing | A file with its usage count |
| PATCH / DELETE | `/api/v1/media/{id}` | own: `media.upload`; anyone's: `media.manage` | Edit title/alt text/caption; delete |
| GET | `/api/v1/jobs` | `jobs.manage` | Background jobs (`status`, paging; payloads are not exposed) |
| GET | `/api/v1/jobs/overview` | `jobs.manage` | Counts, backlog age, worker heartbeats |
| POST | `/api/v1/jobs/{id}/retry` | `jobs.manage` | Retry a dead job |
| DELETE | `/api/v1/jobs/{id}` | `jobs.manage` | Discard a dead job |
| GET / HEAD | `/uploads/{key}` | public | Stored media files (outside `/api`; immutable caching, byte ranges, `nosniff`, sandboxing CSP) |

Privilege-escalation rules apply on top of capabilities: nobody can grant capabilities they do not hold, manage a user
who holds capabilities they lack, change their own role or status, edit their own role, or remove the last active
Super Administrator (409).

**Content policy.** "Per entry" means the route's capability check is followed by the content policy: own entries
need `content.create`, others' need `content.edit_others`; published or scheduled entries additionally need
`content.publish` (so contributors cannot change live content); publishing and scheduling need `content.publish`;
trash, restore and permanent deletion need `content.delete` on top of the edit rules. Users who may not see an entry
get `404`, not `403`. The `permissions` object in entry responses reports what the caller may do.
