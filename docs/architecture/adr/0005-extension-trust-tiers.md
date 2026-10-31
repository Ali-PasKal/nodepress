# ADR 0005 — Plugins run in explicit trust tiers

**Status:** Accepted (design; implementation in Milestone 6)

## Context
A plugin ecosystem is a core product goal, and plugins are the largest attack surface of comparable CMSs.
Node.js offers no in-process sandbox, and a manifest or TypeScript types do not constrain what code can do.

## Decision
- **Declarative** extensions (widgets composed from primitives, content types, templates, settings) are data validated by core and need no code execution.
- **Sandboxed** plugins (third-party code) run in a separate isolated process with resource limits and no direct database, filesystem or network access; they interact through a capability-checked RPC API whose permissions an administrator grants explicitly.
- **Trusted** plugins (first-party, or explicitly approved) run in-process as NestJS modules with full privileges, behind a clear warning and approval step.
- Plugin admin UIs render in sandboxed iframes on a separate origin and communicate with the admin through a typed `postMessage` bridge; plugin scripts are never injected into the admin origin.
- Activation is transactional, with a lifecycle state machine and rollback on failure.

## Consequences
- Third-party plugins are more constrained than WordPress plugins; some capabilities need to be exposed deliberately through the RPC API.
- The sandbox process model adds operational complexity in M6 and needs its own threat-model review.
