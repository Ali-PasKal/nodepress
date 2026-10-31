# ADR 0002 — PostgreSQL is the system of record; the Redis-compatible cache is optional

**Status:** Accepted (Milestone 1)

## Context
Operators range from single small sites to larger installations. Requiring extra stateful services raises
the hosting bar and adds failure modes. Redis' licence changed in 2024 (RSAL/SSPL, then AGPL for Redis 8),
which matters for a commercially distributed product.

## Decision
- PostgreSQL stores everything durable: content, users, sessions, audit events, and (from M3) the background job queue (`SELECT … FOR UPDATE SKIP LOCKED`, transactional enqueue via an outbox).
- A Redis-compatible store is optional and used only for caching and distributed rate-limit counters. The development stack uses **Valkey** (BSD-3-Clause). The client (`ioredis`) works with Valkey and Redis.
- The application must be correct with the cache absent or unavailable: readiness reports `degraded`, not `error`, when the cache is down.

## Consequences
- One required stateful dependency. Backups cover one database plus object storage.
- PostgreSQL-backed queues have lower throughput than dedicated brokers; sufficient for CMS workloads, revisit if profiling says otherwise.
- Cache-dependent features need a PostgreSQL fallback path.
