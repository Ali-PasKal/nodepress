import type {
  PluginContentItem,
  PluginContentQuery,
  PluginEntryContext,
  PluginEntryEvent,
  PluginHook,
  PluginSettingValues,
  PluginShortcodeAttrs,
  RichTextDocument,
} from '@nexora/shared';

/**
 * Types for writing NEXORA plugins. A plugin is an ES module whose default export lists its handlers:
 *
 * ```js
 * import { definePlugin } from '@nexora/plugin-sdk';
 * export default definePlugin({
 *   shortcodes: { hello: (attrs, ctx) => `Hello, ${attrs.name}!` },
 * });
 * ```
 *
 * The code runs in a sandbox (QuickJS in WebAssembly, in its own process): there is no `require`, `fetch`,
 * `process`, filesystem or timers — only `ctx`. Bundle any dependencies into the one file named by the
 * manifest's `main`; imports are not resolved at run time.
 */

export type {
  PluginContentItem,
  PluginContentQuery,
  PluginEntryContext,
  PluginEntryEvent,
  PluginHook,
  PluginManifest,
  PluginPermission,
  PluginSettingDefinition,
  PluginSettingValues,
  PluginShortcodeAttrs,
  PluginShortcodeDefinition,
  RichTextDocument,
} from '@nexora/shared';

export interface FetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface FetchResponse {
  readonly status: number;
  /** content-type, location, etag, last-modified and retry-after, when present. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface PluginLogger {
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

export interface PluginContext<Settings extends PluginSettingValues = PluginSettingValues> {
  /** The plugin's settings (defaults for anything not set; secrets as stored). */
  readonly settings: Readonly<Settings>;
  readonly log: PluginLogger;
  /** A private key–value store (values are JSON, at most 16 KB each, 1 MB and 1,000 keys in total). */
  readonly storage: {
    get<Value = unknown>(key: string): Promise<Value | null>;
    set(key: string, value: unknown): Promise<null>;
    delete(key: string): Promise<null>;
  };
  /** Published content (needs the `content:read` permission). */
  readonly content: {
    list(query?: PluginContentQuery): Promise<PluginContentItem[]>;
    get(id: string): Promise<PluginContentItem | null>;
  };
  /** HTTPS requests to the hosts in the manifest (needs the `http:fetch` permission). */
  readonly http: {
    fetch(url: string, init?: FetchInit): Promise<FetchResponse>;
  };
}

/** What a shortcode shows: nothing, plain text, or rich text (checked against the content allowlist). */
export type ShortcodeResult = null | string | RichTextDocument;

export type ShortcodeHandler<Settings extends PluginSettingValues = PluginSettingValues> = (
  attrs: PluginShortcodeAttrs,
  ctx: PluginContext<Settings> & { readonly entry: PluginEntryContext },
) => ShortcodeResult | Promise<ShortcodeResult>;

export type HookHandler<Settings extends PluginSettingValues = PluginSettingValues> = (
  event: PluginEntryEvent,
  ctx: PluginContext<Settings>,
) => void | Promise<void>;

export interface PluginDefinition<Settings extends PluginSettingValues = PluginSettingValues> {
  readonly shortcodes?: Readonly<Record<string, ShortcodeHandler<Settings>>>;
  readonly hooks?: Readonly<Partial<Record<PluginHook, HookHandler<Settings>>>>;
}

/** Identity function that gives a plugin definition its types. */
export function definePlugin<Settings extends PluginSettingValues = PluginSettingValues>(
  definition: PluginDefinition<Settings>,
): PluginDefinition<Settings> {
  return definition;
}
