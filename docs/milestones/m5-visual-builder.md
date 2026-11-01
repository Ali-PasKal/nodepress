# Milestone 5 — Visual builder and shortcodes

## Starting point
M4 delivered the public site: published entries are rendered by the starter theme from the Delivery API. Every
entry body is a rich-text document; there is no way to lay out a page visually (sections, columns, buttons,
images side by side) and no way to place dynamic content (latest posts, galleries) inside text.

## Scope

**In scope**
- **Builder documents**: a typed, versioned JSON document per entry — sections containing columns containing
  widgets — with per-breakpoint style overrides (desktop, tablet, mobile) and responsive visibility. Validated by
  the same Zod schema in the browser and the API; documents carry a `schemaVersion` and are upgraded on read by
  pure migration functions; documents from a newer version are refused rather than guessed at.
- **Widgets** (first-party, registered with a typed property schema): heading, text (rich text), image, button,
  spacer, divider, video (YouTube/Vimeo, privacy-enhanced embed), posts (latest posts of a type or term), shortcode,
  and HTML embed.
- **Shortcodes**: WordPress-style `[name attr="value"]` placeholders that work in rich text (posts, pages, builder
  text widgets) and in the shortcode widget. Only registered shortcodes exist (`button`, `recent_posts`,
  `gallery`, `video`, `site_name`, `year`); attributes are validated against each shortcode's schema; dynamic data
  (posts, media) is resolved by the Delivery API; output is rendered by React components. Unknown or invalid
  shortcodes are shown as literal text (as WordPress does) and flagged in the editor; `[[name]]` shows `[name]`.
- **Editor** (admin, full screen): widget library, canvas rendering the same components as the public site,
  drag and drop (pointer and keyboard), navigator tree, properties panel (content, style per breakpoint,
  visibility), undo/redo, device preview (desktop, tablet, mobile), saving through the existing optimistic
  concurrency, revisions and publishing workflow, preview links.
- **Entries**: an entry uses either the rich-text editor or the builder (`editor` field); content types opt in to
  the builder (`hasBuilder`, on for pages). Revisions capture builder documents; admin search covers builder text.
- **Public site**: the theme renders builder documents full width; per-document CSS is compiled from validated
  values and delivered inline with a CSP hash (no `unsafe-inline`); responsive overrides use container queries so
  the editor canvas and the site behave identically.
- **HTML embed**: arbitrary HTML is served from its own URL with `Content-Security-Policy: sandbox` (opaque
  origin: no access to the site's cookies, storage or DOM) and shown in a sandboxed iframe. Saving HTML embeds
  requires the new capability `content.embed_html` (administrator, editor).

**Out of scope (later milestones)**
- Reusable/global sections and templates library, theme template editing (M7).
- Third-party widgets and shortcodes from plugins (the registries are designed for it; plugins arrive in M6).
- Forms (M7), animations, custom CSS per element, nested sections inside columns.
- Converting existing rich text into a builder document automatically (an entry can switch; the rich-text body is
  kept and the builder starts from a text widget containing it).

## Key decisions
| Decision | Rationale |
|---|---|
| Section → column → widget tree with a fixed depth | Covers the common page layouts; a fixed depth keeps validation, rendering and drag-and-drop simple and bounded |
| Styles are typed values (hex colours, bounded numbers, enums), never raw CSS | Values can be validated, so compiled CSS cannot be injected; arbitrary CSS would be an injection channel |
| Inline per-document `<style>` allowed by a SHA-256 in the CSP | Keeps the "no inline code" policy without a per-request nonce, so pages stay deterministic and cacheable (ETags) |
| Container queries for breakpoints | The editor's device preview resizes a container, not the browser window; the same CSS works in both places |
| Shortcodes are a registry of typed components, resolved on the server | WordPress compatibility of the syntax without executing anything: no expression language, no PHP-style callbacks |
| Unknown shortcodes render as literal text | Matches WordPress; makes problems visible (e.g. after an import) instead of silently dropping content |
| HTML embeds on a separate URL with a CSP sandbox, capability-gated | Third-party snippets (maps, booking widgets) need scripts; an opaque origin keeps them away from the site and the admin |
| Drag and drop with `@dnd-kit` | Accessible (keyboard sensor, screen reader announcements), works with touch, maintained |

## Capabilities
| Capability | Administrator | Editor | Author | Contributor |
|---|---|---|---|---|
| `content.embed_html` (save HTML embed widgets) | ✓ | ✓ | | |

Everything else follows the existing content policy (the builder edits the entry like any other field).

## Risks
- XSS through widget properties or shortcode attributes → typed schemas, URL checks, React rendering, compiled CSS
  only from validated values, tests with hostile values.
- HTML embed abuse → capability, sandboxed opaque origin, no `allow-same-origin`, editor shows a placeholder only.
- Document schema evolution → `schemaVersion` with migrations; newer documents refused.
- Large documents → node and size limits; validation is iterative and bounded.
- Drag-and-drop accessibility → keyboard sensor plus move up/down buttons and navigator.

## Acceptance criteria
1. Builder documents are validated identically in browser and API (structure, limits, widget properties, styles);
   invalid or hostile documents are rejected with field paths; newer schema versions are refused.
2. Shortcodes: parsing (attributes, quoting, escaping, unknown names), validation and server-side resolution work
   in rich text and builder text/shortcode widgets; hostile attributes cannot produce unsafe output.
3. The editor builds a page (add, drag and drop, reorder, nest into columns, edit properties and per-breakpoint
   styles, hide per device, undo/redo, duplicate, delete) and saves it with version checks and revisions.
4. The public site and previews render builder pages identically to the canvas (same components and CSS),
   responsive at 375/768/1280, with a CSP that allows the document style by hash and no violations.
5. Dynamic widgets and shortcodes (posts, gallery) show only publicly visible content.
6. HTML embeds run only in a sandboxed opaque origin and can only be saved with `content.embed_html`.
7. All checks (lint, format, typecheck, build, bundle budget, unit/integration, E2E, drift, audit) pass on Node 22
   and 23.7; CI green.

## Results
All seven criteria are met; evidence, the verification run, known limitations and the security notes are in
[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md#milestone-5--visual-builder-and-shortcodes).
