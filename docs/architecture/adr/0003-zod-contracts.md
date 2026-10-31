# ADR 0003 — Zod schemas are the single source of truth for API contracts

**Status:** Accepted (Milestone 1)

## Context
The API, the admin, SDKs and (later) plugins must agree on request/response shapes, and every boundary must
validate untrusted data at runtime. Maintaining separate TypeScript types, validation rules and OpenAPI
annotations invites drift.

## Decision
- Contracts are Zod 4 schemas in `packages/shared` (framework-free).
- The API validates inbound data with these schemas (from M2) and documents responses by passing them to `@nestjs/swagger`'s `standardSchema` option, which converts them to OpenAPI via Zod's Standard JSON Schema support.
- Clients validate responses at runtime (`apiGet` in the admin rejects any response that does not match).
- Environment configuration, editor documents (M5) and plugin/theme manifests (M4/M6) use Zod too.

## Consequences
- One schema language across the stack; OpenAPI stays in sync with the code (`pnpm --filter @nexora/api run openapi:export`).
- Zod adds weight to the browser bundle (about 34 kB gzipped together with TanStack Query in the `data` chunk). Acceptable for the admin; the public site renderer will not ship Zod to visitors.
- In the browser, Zod runs in **jitless** mode (`apps/admin/src/zod-config.ts`). Zod's JIT compiles parsers with `new Function`, and even its capability probe violates the admin CSP, which deliberately omits `'unsafe-eval'`. An end-to-end test fails on any CSP violation.
