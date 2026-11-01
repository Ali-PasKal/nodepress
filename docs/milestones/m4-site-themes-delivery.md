# Milestone 4 — Public site, themes and Delivery API

## Starting point
M3 delivered the content model, media and background jobs. Content can be published, but nothing renders it for
visitors: `/` in the container topology returns 404 and there is no read API for published content.

## Scope

**In scope**
- **Delivery API** (`/api/v1/delivery/*`, public, read-only): resolves a public URL to a page (home, entry, archive,
  redirect or not found) together with the site data a theme needs (identity, menus, theme settings, SEO defaults);
  listings with pagination; sitemap and feed data. It only ever returns published content: status `published`, not
  trashed, publication time reached, public content type, and every ancestor of a hierarchical entry published too.
- **URLs**: content types and taxonomies get a route prefix (`/blog/…` for posts, pages at the root, `/category/…`,
  `/tag/…`, custom types under their own prefix); reserved paths are protected; home shows the latest posts or a
  chosen page; `?page=N` pagination.
- **Redirects**: automatic 301s when a published entry's path or a term's slug changes (chains flattened), plus
  manual redirects managed in the admin.
- **Previews**: an editor can open a draft on the public site through a short-lived, hashed, unguessable preview
  link (`noindex`, `no-store`, no referrer).
- **Site runtime** (`apps/site-runtime`): a separate Node process that server-renders pages with React from Delivery
  API data. It holds no credentials and has no database access, so it cannot show drafts by construction.
- **Themes**: a theme SDK (`packages/theme-sdk`: types, safe rich-text and image components, helpers) and a starter
  theme (`packages/theme-starter`): responsive, accessible, no client-side JavaScript, light/dark, logical CSS
  properties so right-to-left languages (Persian, Arabic, Hebrew) work. Theme settings are declared by the theme and
  validated by the API.
- **Menus**: menus with nested items (entry, term, home or custom link) assigned to theme locations.
- **SEO fundamentals**: per-entry SEO title, description and `noindex`; site-wide title template, default description
  and social image, and a search-engine visibility switch; canonical URLs, Open Graph/Twitter tags, JSON-LD,
  `sitemap.xml`, `robots.txt`, an RSS feed.
- **Site settings**: tagline, language (and text direction), home page mode, posts per page.
- **Admin**: Appearance (theme, theme settings, site identity and reading settings), Menus, SEO (settings and
  redirects), SEO panel and View/Preview buttons in the editor, route prefix and visibility for content types, a
  dashboard home page.
- **Security**: strict CSP on public pages (no scripts and no inline styles at all; theme settings arrive as a
  stylesheet), safe output encoding (React, XML escaping, JSON-LD escaping), no-store previews, caching headers
  with ETags.

**Out of scope (later milestones)**
- The visual page builder and widget documents (M5); pages use the rich-text body until then.
- Additional themes, uploading third-party theme code (themes are code and arrive with the extension system, M6/M7).
- Server-side HTML caching or a CDN integration (M7 performance); M4 renders per request with ETags.
- Full-text site search, comments, multilingual content, custom permalink patterns.

## Key decisions
| Decision | Rationale |
|---|---|
| Separate site-runtime process that only talks to the public Delivery API | Draft isolation by construction (the process cannot query drafts), crash and load isolation from the admin API, no credentials on the public tier |
| React server rendering for themes | Output is escaped by default (no template injection), themes are typed, and the M5 builder can render widgets with the same technology |
| Themes are code packages selected by key; settings are data validated against the theme's declared schema | Uploading theme code is an extension-trust problem (M6); settings are safe to store and edit |
| Route prefixes per content type and taxonomy, pages at the root | Predictable URLs without collisions; the API rejects root pages whose first segment is a reserved prefix |
| Preview tokens stored hashed in the database (1 hour) | Same model as reset tokens: revocable, works across instances, no new long-lived secret |
| No client-side JavaScript in the starter theme | Fast pages, smallest attack surface: the CSP has no script source at all (JSON-LD is a non-executable data block), and without nonces the HTML is deterministic, so ETags and 304 responses work |
| Custom fields are public only when marked so (off by default) | Data minimisation: fields added for internal use must not appear in a public API by accident |
| Route prefix changes are allowed and create redirects for every published entry (up to 10 000 per change) | Restricting changes would block legitimate restructuring; redirects keep existing links working |
| Per-request rendering with ETags instead of an HTML cache | Always fresh after publishing; caching and invalidation belong to the performance milestone |

## Capabilities
| Capability | Administrator | Editor |
|---|---|---|
| `appearance.manage` (theme, theme settings, site identity, reading settings, menus) | ✓ | |
| `seo.manage` (SEO settings, redirects) | ✓ | ✓ |

Per-entry SEO fields are part of editing the entry and follow the content policy.

## Risks
- Draft leakage through public paths → the site runtime only uses public delivery endpoints; delivery queries share
  one "publicly visible" predicate; tests for every status, trash, scheduling, ancestors and non-public types.
- XSS through titles, fields, menus or settings → React escaping, the rich-text allowlist, URL checks in components,
  XML/JSON-LD escaping, strict CSP; tests with hostile content.
- Open redirects → redirect targets are site paths or validated http(s) URLs set by authorised users only.
- Preview token leakage → short lifetime, hashed at rest, `Referrer-Policy: no-referrer`, `noindex`, `no-store`.
- Route collisions → reserved-path validation on prefixes and root pages, tested.

## Acceptance criteria
1. The Delivery API returns only publicly visible content; drafts, pending, scheduled (before their time), trashed,
   non-public types and entries under unpublished ancestors are never returned (tested per case).
2. URLs resolve for home (posts or static page), posts, nested pages, custom types, taxonomy archives and
   pagination; reserved paths and prefix collisions are rejected.
3. Changing a published entry's path or a term's slug creates 301 redirects (descendants included, chains
   flattened); manual redirects work; redirect targets cannot point to arbitrary schemes.
4. Preview links show the latest saved draft only to holders of a valid, unexpired link; pages are `noindex` and
   `no-store`.
5. The site runtime renders every page type with the starter theme, returns correct status codes (200/301/404/503),
   ETags, and a strict CSP without violations; hostile content is escaped.
6. Menus, theme settings, tagline, language/direction, home mode and posts per page affect the rendered site.
7. SEO output: titles via template, description, canonical, Open Graph, JSON-LD, `noindex` handling,
   `sitemap.xml`, `robots.txt` (including the visibility switch) and the RSS feed are correct and escaped.
8. Admin: appearance, menus, SEO and redirects pages, editor SEO panel and View/Preview, content type route
   settings, dashboard — working against the real API, accessible, responsive, within the bundle budget.
9. `nexora dev` serves admin, API and site from one origin; the Compose stack serves the site at `/` through nginx.
10. All checks (lint, format, typecheck, build, bundle budget, unit/integration, E2E, drift, audit) pass on Node 22
    and 23.7; CI green.
