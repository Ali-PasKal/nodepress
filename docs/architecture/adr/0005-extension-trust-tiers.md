# ADR 0005 — Plugins run in explicit trust tiers

**Status:** Accepted; implemented in Milestone 6 (see “Implementation” below)

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

## Implementation (Milestone 6)
- **Sandboxed** is the only tier that runs code. The isolation is QuickJS compiled to WebAssembly (no host APIs
  except the injected `ctx`) inside one child process per plugin, started with an empty environment and Node's
  permission model; limits are an engine deadline, a hard WebAssembly memory cap and a parent watchdog. A JS engine
  inside WebAssembly was chosen because Node.js has no in-process sandbox and its permission model is not a security
  boundary; the process boundary keeps the API's memory and secrets out of reach and contains crashes.
- **Declarative** parts are manifest data (settings forms, shortcode attribute types, permissions, hosts).
  Declarative widgets, content types and templates are later work.
- **Trusted** in-process plugins are not offered: uploaded code never runs in the API process, and first-party
  plugins run sandboxed too.
- Plugin admin UIs (sandboxed iframes on a separate origin) are deferred; plugins get a generated settings form
  instead. Activation is transactional with a smaller state machine (`inactive ⇄ active`, `failed`), and the code
  is loaded and checked in a throwaway sandbox before activation.

