# Architecture Decision Records

Short records of decisions that are expensive to reverse. Format: context → decision → consequences.
Superseded records are kept and marked, never deleted.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith with explicit module boundaries | Accepted |
| [0002](0002-postgresql-system-of-record.md) | PostgreSQL is the system of record; Redis-compatible cache is optional | Accepted |
| [0003](0003-zod-contracts.md) | Zod schemas in `packages/shared` are the single source of truth for API contracts | Accepted |
| [0004](0004-single-origin-path-routing.md) | Single-origin path routing (`/`, `/admin/`, `/api/`) by default | Accepted |
| [0005](0005-extension-trust-tiers.md) | Plugins run in explicit trust tiers; manifests are not a security boundary | Accepted |
