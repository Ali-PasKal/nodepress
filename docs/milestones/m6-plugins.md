# Milestone 6 — Plugins

## Starting point
M5 delivered the visual builder and a fixed registry of shortcodes. Everything a site can do is compiled into
the application; there is no way to add behaviour (new shortcodes, reactions to publishing, integrations with
other services) without changing the code. ADR 0005 decided that third-party code runs in explicit trust tiers
and never in the API process.

## Scope

**In scope**
- **Plugin packages**: a `.zip` with a manifest (`nexora-plugin.json`) and one bundled JavaScript file (an ES
  module whose default export lists the plugin's handlers), optionally a README and licence. The manifest
  declares identity (`id` such as `acme.reading-time`, name, semantic version, author), the plugin API version,
  permissions, settings, shortcodes and event hooks. Packages are parsed by a strict reader (size, entry and
  ratio limits, no encrypted or ZIP64 archives, CRC checks) and stored in the database — nothing is written to
  disk.
- **Sandboxed execution (the only way third-party code runs)**: each active plugin gets its own child process
  that runs the plugin inside the QuickJS JavaScript engine compiled to WebAssembly. The plugin sees no Node.js
  APIs (no filesystem, network, processes, timers or globals of the host) — only the context object the core
  gives it. Limits on three layers: per-call CPU deadline and stack limit in the engine; a hard cap on the
  engine's WebAssembly memory; and the parent process, which kills the child when a call overruns its deadline or
  the process its memory budget, restarts it with backoff and marks the plugin as failed after repeated crashes.
  The child process starts with an empty environment (no database URL or secrets) and Node's permission model
  (read access to its own code only; no child processes, workers or native addons). Every message from the child
  is validated; results are size-limited and schema-checked.
- **Capabilities available to plugins** (everything else is impossible by construction):
  - always: their settings, a key–value storage of their own (quota), logging (shown in the admin);
  - `content:read` (permission): published content only, through the same visibility rules as the public site;
  - `http:fetch` (permission, with the hosts named in the manifest): outbound HTTPS requests made **by the core**
    through an SSRF guard — exact host allowlist, DNS resolution with private, loopback, link-local and
    reserved addresses refused and the connection pinned to the checked address, no redirects followed, time,
    size and rate limits.
- **Extension points**:
  - **Shortcodes**: plugins register shortcodes (namespaced by their declared names, no collisions with core or
    other plugins) with declarative attribute types validated by the core. The handler returns rich text, which
    must pass the same allowlist schema as stored content; the Delivery API resolves plugin shortcodes on the
    server (deadline, per-page limit, short cache) and themes render the result like any rich text (without
    expanding shortcodes inside it). Works in posts, pages and builder widgets; the editor knows active plugin
    shortcodes.
  - **Event hooks**: `entry.published` and `entry.unpublished`, delivered through the durable job queue
    (enqueued in the same transaction as the change; at-least-once, retried) with public data only.
- **Lifecycle**: install (upload or a bundled first-party plugin) → activate (the administrator reviews and
  grants the requested permissions; the core loads the code in the sandbox and checks that the declared handlers
  exist; failures leave it inactive with the error) ⇄ deactivate → uninstall (removes code, settings, storage
  and logs). Updates replace the code; if an update asks for more permissions, the plugin is deactivated until
  they are granted. Every lifecycle change is audited. New capability `plugins.manage` (administrator).
- **Admin**: Plugins page (installed and bundled plugins, status, version, permissions, errors), upload,
  activation dialog that lists permissions in plain language and states what the sandbox prevents, generated
  settings form (text, multi-line text, number, yes/no, choice, secret), recent log lines, deactivate, update,
  uninstall.
- **Plugin SDK** (`packages/plugin-sdk`): types for manifests and the plugin context, `definePlugin`, and a
  test harness that runs a plugin in the real sandbox with fake capabilities; `nexora plugin pack` builds a
  checked package from a folder.
- **First-party plugins** (`plugins/`, sandboxed like any other): *Reading time* (`[reading_time]`, no
  permissions), *Related posts* (`[related_posts]`, `content:read`), *Publish notifications* (posts to Slack or
  Discord webhooks on publish, `http:fetch` to those two hosts only).

**Out of scope (later milestones)**
- Trusted in-process plugins: no uploaded code runs in the API process. (First-party features keep shipping as
  core modules.)
- Plugin admin pages with their own UI (sandboxed iframes on a separate origin), builder widgets, routes, write
  access to content, scheduled plugin tasks, a plugin directory/marketplace, signatures and automatic updates.
- Running WordPress plugins (PHP) — not a goal (see architecture non-goals).

## Key decisions
| Decision | Rationale |
|---|---|
| QuickJS compiled to WebAssembly, inside a separate child process per plugin | Node.js has no in-process sandbox (the permission model is a "seat belt", not a boundary). A JS engine inside WebAssembly exposes nothing but what the core injects; the process boundary keeps the API's memory (secrets, sessions) out of reach even if the engine were escaped, and isolates crashes and resource exhaustion per plugin |
| Hard WebAssembly memory cap plus parent watchdog | Measured: QuickJS's own memory accounting is unreliable in this build (a plugin allocated ~1.5 GB despite a 16 MB limit) and its CPU interrupt is rarely checked during long native operations; a capped `WebAssembly.Memory` fails allocations cleanly, and the parent kills overrunning calls |
| Fresh engine context per call | No state leaks between calls or between visitors; plugins keep state only in their storage |
| Capabilities are core-implemented RPC calls checked against granted permissions | The plugin never holds credentials or sockets; the core enforces permissions, quotas and the SSRF guard |
| Shortcode output is rich-text JSON validated by the existing allowlist | Plugins cannot emit HTML, scripts or unsafe URLs; themes render it with the existing safe renderer |
| Events through the job queue | Publishing is never slowed or broken by a plugin; delivery survives restarts |
| Package stored in the database | No filesystem writes, no path traversal, works with several API instances |
| First-party plugins run sandboxed too | The sandbox is exercised by real plugins; no special trust path |

## Capabilities
| Capability | Administrator | Editor | Author | Contributor |
|---|---|---|---|---|
| `plugins.manage` (install, activate, configure, update, uninstall plugins) | ✓ | | | |

## Risks
- Sandbox escape through a QuickJS or V8/WebAssembly bug → process boundary, empty environment, permission
  model, no secrets in the child; documented residual risk (the child can still open network sockets if the
  engine and WebAssembly sandbox were both escaped).
- Resource exhaustion (CPU, memory, output size, log spam, storage) → engine limits, memory cap, watchdog,
  quotas, rate limits, per-page shortcode limits.
- SSRF through `http:fetch` → host allowlist approved by the administrator, address checks after DNS
  resolution with a pinned connection, no redirects, HTTPS only.
- Malicious packages (zip bombs, oversized or malformed archives) → strict reader with limits before
  decompression and bounded output.
- Confusing trust → the UI and docs say exactly what a plugin can and cannot do; nothing is presented as
  "trusted".

## Acceptance criteria
1. Plugin packages are validated (manifest, files, limits); malformed, oversized and hostile archives are
   rejected with clear errors.
2. Plugin code runs only in the sandbox process: it cannot reach Node.js APIs, the filesystem, the network,
   environment variables or other plugins; infinite loops, memory exhaustion, deep recursion and huge outputs are
   stopped without affecting the API, and repeated crashes mark the plugin as failed.
3. Capabilities are enforced: calls without a granted permission are refused; storage quotas, rate limits and
   the SSRF guard work (private addresses, unlisted hosts, redirects and plain HTTP refused).
4. Lifecycle: install (upload and bundled), activate with permission approval, deactivate, update (re-approval
   when permissions grow), uninstall; failures roll back; all audited; only `plugins.manage` holders can do it.
5. Plugin shortcodes render on the public site (posts, pages, builder) from validated rich text, with
   deadlines and limits; inactive plugins' shortcodes stay literal; the editor recognises active ones.
6. Event hooks are delivered at least once through the job queue with public data only.
7. The SDK test harness and `nexora plugin pack` work; the three first-party plugins are tested.
8. Admin: plugins page, upload, permission review, settings, logs — accessible and responsive; E2E covers
   installing and activating a plugin whose shortcode then appears on the site.
9. All checks (lint, format, typecheck, build, bundle budget, unit/integration, E2E, drift, audit) pass on
   Node 22 and 23.7; CI green.
