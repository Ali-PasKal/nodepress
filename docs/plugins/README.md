# Writing NEXORA plugins

A plugin adds **shortcodes** (content placed in posts, pages and builder widgets) and reacts to **events**
(an entry is published or unpublished). It is a folder with a manifest and one JavaScript file, packaged as a
`.zip` and uploaded under **System → Plugins** in the admin.

Plugins never run inside NEXORA itself. Each active plugin runs in its own process, inside a separate JavaScript
engine (QuickJS compiled to WebAssembly). Your code sees plain JavaScript — no `require`, `fetch`, `process`,
timers, filesystem or network — plus the `ctx` object NEXORA passes to your handlers. Everything else is
impossible by construction, so the administrator only has to judge the permissions you ask for.

The three first-party plugins in [`plugins/`](../../plugins) are complete examples:
[Reading time](../../plugins/reading-time) (no permissions), [Related posts](../../plugins/related-posts)
(`content:read`) and [Publish notifications](../../plugins/publish-notifications) (`http:fetch`).

## A first plugin

```
hello/
  nexora-plugin.json
  plugin.js
  README.md        (optional, shown in the admin as plain text)
```

`nexora-plugin.json`:

```json
{
  "id": "acme.hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiVersion": 1,
  "main": "plugin.js",
  "description": "Greets visitors: [hello name=\"…\"].",
  "settings": [{ "key": "greeting", "label": "Greeting", "type": "text", "default": "Hello" }],
  "shortcodes": [
    {
      "name": "hello",
      "label": "Hello",
      "example": "[hello name=\"you\"]",
      "attributes": { "name": { "type": "string", "required": true, "maxLength": 50 } }
    }
  ]
}
```

`plugin.js` (an ES module; its default export lists the handlers):

```js
/** @type {import('@nexora/plugin-sdk').PluginDefinition<{ greeting: string }>} */
export default {
  shortcodes: {
    hello(attrs, ctx) {
      return `${ctx.settings.greeting}, ${attrs.name}!`;
    },
  },
};
```

Check and package it, then upload the `.zip`:

```bash
pnpm nexora plugin check ./hello
```

```bash
pnpm nexora plugin pack ./hello --out hello.zip
```

Outside this repository, the SDK's `nexora-plugin check|pack <folder>` does the same.

## The manifest

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | Lowercase with at least one dot (`acme.hello`); unique per site. Uploading a package with the same id updates the plugin |
| `name`, `version` | ✓ | `version` is semantic (`1.2.0`); older versions than the installed one are refused |
| `apiVersion` | ✓ | `1` (the plugin API this NEXORA implements; newer values are refused) |
| `main` | ✓ | The JavaScript file in the package root |
| `description`, `author`, `homepage` (https), `license` | | Shown in the admin |
| `permissions` | | `content:read`, `http:fetch` (see below) |
| `hosts` | with `http:fetch` | Exact host names your plugin may call (`hooks.slack.com`); no wildcards or IP addresses |
| `settings` | | Fields of the generated settings form: `text` (`maxLength`, `multiline`, `default`), `number` (`min`, `max`, `integer`, `default`), `boolean`, `select` (`options`, `default`), `secret` (`maxLength`; stored, passed to your code, never shown again) |
| `shortcodes` | | `name` (lowercase, not a built-in shortcode), `label`, `description`, `example`, `attributes` |
| `hooks` | | `entry.published`, `entry.unpublished` |

Every shortcode and hook in the manifest must be exported by your code; NEXORA loads the code in the sandbox and
checks this before activation.

**Shortcode attributes** are declared with types — `string` (`maxLength`, `required`, `default`), `number`
(`min`, `max`, `integer`, `required`, `default`), `boolean` (`default`; written as `flag`, `flag="true"` or
`flag="no"`), `enum` (`values`, `required`, `default`). NEXORA validates them before calling you; a shortcode
with unknown or invalid attributes is shown as plain text, and the editor flags it.

## Handlers and the context

```ts
shortcodes: { [name]: (attrs, ctx) => null | string | RichTextDocument | Promise<…> }
hooks: { 'entry.published' | 'entry.unpublished': (event, ctx) => void | Promise<void> }
```

`ctx` contains:

| Member | Available | |
|---|---|---|
| `ctx.settings` | always | The plugin's settings (defaults for anything not set) |
| `ctx.entry` | shortcodes | The entry the shortcode is on: `id`, `type`, `title`, `url`, `wordCount`, `terms` |
| `ctx.storage.get/set/delete(key, value)` | always | A private key–value store: JSON values up to 16 KB, 1,000 keys and 1 MB in total |
| `ctx.log.info/warn/error(…)`, `console.log` | always | Lines appear under *Recent log* on the plugin's page (20 per call) |
| `ctx.content.list(query)`, `ctx.content.get(id)` | `content:read` | Published content only: `{ id, type, title, url, excerpt, publishedAt, terms }`. `query`: `type`, `terms` (`["category:news"]`), `exclude` (ids), `limit` (≤ 20) |
| `ctx.http.fetch(url, { method, headers, body })` | `http:fetch` | HTTPS to the manifest's hosts only, made by NEXORA: private addresses refused, no redirects followed, 5 s, 256 KB responses, 64 KB bodies, 60 requests per minute. Returns `{ status, headers, body }` |

A call without the permission rejects with an error your code can catch.

**Shortcode output** is shown where the shortcode appears. Return `null` (nothing), a string (plain text), or a
rich-text document — the same JSON NEXORA stores for content (`{ type: 'doc', content: [...] }` with paragraphs,
headings, lists, links, bold, …). Rich text goes through the same allowlist as stored content: no HTML, no
scripts, only safe links. A single paragraph renders inline; anything else as a block. Shortcodes inside your
output are not expanded.

**Events** carry public data only: `{ event, entry: { id, type, title, url, excerpt, publishedAt }, occurredAt }`
(the `url` is absolute). They are delivered by NEXORA's job queue after the change is saved — at least once, so
handlers should tolerate duplicates. Throwing (or a non-2xx answer you turn into an error) makes NEXORA retry up
to three times.

## Limits

Each call gets a fresh engine (nothing survives between calls — use `ctx.storage`):

- **Time:** shortcodes 0.5 s (and at most 10 plugin shortcodes, 2 s, per page; results are cached for 30 s);
  hooks 10 s. Code that does not stop in time is interrupted, or its process is killed.
- **Memory:** 64 MB per plugin (`PLUGINS_MEMORY_MB`); allocations beyond fail with “out of memory”.
- **Calls:** 50 storage/content/http calls per invocation; results up to 256 KB.
- A plugin whose process crashes three times within ten minutes is marked **failed** and stops running until an
  administrator activates it again.

Bundle dependencies into your one file (for example with esbuild, `--format=esm --bundle`); `import` statements
are not resolved at run time. Libraries that need Node.js or browser APIs will not work.

## Testing

`@nexora/plugin-sdk/testing` runs your plugin the way NEXORA does — same engine, same attribute validation, same
output allowlist, same permission checks — with in-memory storage, content and HTTP:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPlugin } from '@nexora/plugin-sdk/testing';

test('greets', async () => {
  const plugin = await loadPlugin(new URL('..', import.meta.url).pathname, { settings: { greeting: 'Hi' } });
  assert.equal(await plugin.shortcodeText('hello', { name: 'Ada' }), 'Hi, Ada!');
});
```

`loadPlugin(folder, { settings, content, fetch })` returns a harness with `shortcode(name, attrs, entry)`,
`shortcodeText(…)`, `hook(event, entry)`, and the `storage`, `logs` and `requests` it recorded.

## Installing and the administrator's view

Uploading installs a plugin **inactive**. Activating shows the administrator the permissions and hosts the
manifest asks for, in plain language; activation grants exactly those. An update that asks for nothing new keeps
the plugin active (after its code loads); an update that asks for more deactivates it until the administrator
reviews it again. Uninstalling deletes the code, settings, storage and log. Every step is in the audit log.
