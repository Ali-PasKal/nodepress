# ADR 0001 — Modular monolith with explicit module boundaries

**Status:** Accepted (Milestone 1)

## Context
NEXORA must be easy to self-host (one database, few processes) yet maintainable for years by a team, with
the option of extracting parts later (rendering, media processing, plugin sandbox).

## Decision
- One NestJS application (`apps/api`) containing all server-side domain modules, plus a separate public renderer (`apps/site-runtime`, M4) and a worker entrypoint built from the same codebase (M3).
- Each domain module owns its tables and exposes an application-service API. Modules never query each other's tables; cross-module reactions go through domain events.
- Controllers are thin; business rules live in services; persistence lives in repositories.
- Shared, framework-free contracts live in `packages/*`; packages never import from `apps/*` (ESLint-enforced).

## Consequences
- Simple deployment and transactions across modules while the system is young.
- Boundaries must be policed in review (and by lint rules) because the compiler cannot stop a module from importing another's internals.
- Extracting a module later means replacing in-process calls/events with network calls; the boundary rules make that tractable.
