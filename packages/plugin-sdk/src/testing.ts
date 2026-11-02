import { PluginEngine, type HostCallHandler, type LogLine } from '@nexora/plugin-runtime/engine';
import {
  buildPluginShortcodeAttrsSchema,
  pluginContentQuerySchema,
  pluginShortcodeOutputSchema,
  resolvePluginSettings,
  type PluginContentItem,
  type PluginEntryContext,
  type PluginEntryEvent,
  type PluginHook,
  type PluginManifest,
  type RichTextDocument,
} from '@nexora/shared';
import type { FetchInit, FetchResponse } from './index.js';
import { readPluginDirectory } from './pack.js';

/**
 * Runs a plugin the way NEXORA does — the same sandboxed engine, the same attribute validation, the same
 * output allowlist, the same permission checks — with in-memory stand-ins for storage, content and HTTP.
 *
 * ```ts
 * const plugin = await loadPlugin(new URL('..', import.meta.url).pathname, { settings: { wpm: 200 } });
 * expect(await plugin.shortcodeText('reading_time', {}, { wordCount: 600 })).toBe('3 min read');
 * ```
 */

export interface HarnessOptions {
  /** Stored settings (missing ones take their defaults). */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Published content returned by `ctx.content` (needs `content:read` in the manifest). */
  readonly content?: readonly PluginContentItem[];
  /** Answers `ctx.http.fetch` (needs `http:fetch` and the host in the manifest). */
  readonly fetch?: (url: string, init: FetchInit) => FetchResponse | Promise<FetchResponse>;
  readonly timeoutMs?: number;
}

export class PluginTestError extends Error {
  override readonly name = 'PluginTestError';
}

const DEFAULT_ENTRY: PluginEntryContext = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'post',
  title: 'Test entry',
  url: '/blog/test-entry',
  wordCount: 0,
  terms: [],
};

const STORAGE_VALUE_BYTES = 16 * 1024;

export class PluginHarness {
  /** The plugin's storage (inspect or seed it in tests). */
  readonly storage = new Map<string, unknown>();
  /** Log lines written by the plugin. */
  readonly logs: LogLine[] = [];
  /** Requests the plugin made through `ctx.http.fetch`. */
  readonly requests: { url: string; init: FetchInit }[] = [];

  constructor(
    readonly manifest: PluginManifest,
    private readonly code: string,
    private readonly engine: PluginEngine,
    private readonly options: HarnessOptions,
  ) {}

  /** Renders a shortcode with raw (string) attributes, as written in content. */
  async shortcode(
    name: string,
    attrs: Readonly<Record<string, string>> = {},
    entry: Partial<PluginEntryContext> = {},
  ): Promise<RichTextDocument | null> {
    const definition = this.manifest.shortcodes.find((shortcode) => shortcode.name === name);
    if (!definition) throw new PluginTestError(`The manifest declares no shortcode [${name}].`);
    const parsed = buildPluginShortcodeAttrsSchema(definition).safeParse(attrs);
    if (!parsed.success) {
      throw new PluginTestError(
        `Invalid attributes for [${name}]: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    }
    const value = await this.run('shortcode', name, {
      attrs: parsed.data,
      entry: { ...DEFAULT_ENTRY, ...entry },
    });
    const output = pluginShortcodeOutputSchema.safeParse(value);
    if (!output.success) {
      throw new PluginTestError(
        `[${name}] returned something NEXORA would not show (not text or allowed rich text).`,
      );
    }
    if (output.data === null || output.data === '') return null;
    if (typeof output.data === 'string') {
      return {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: output.data }] }],
      };
    }
    return output.data;
  }

  /** The visible text of a shortcode's output (convenient for assertions). */
  async shortcodeText(
    name: string,
    attrs: Readonly<Record<string, string>> = {},
    entry: Partial<PluginEntryContext> = {},
  ): Promise<string> {
    const document = await this.shortcode(name, attrs, entry);
    const texts: string[] = [];
    const walk = (node: unknown) => {
      if (node === null || typeof node !== 'object') return;
      const record = node as { text?: unknown; content?: unknown };
      if (typeof record.text === 'string') texts.push(record.text);
      if (Array.isArray(record.content)) record.content.forEach(walk);
    };
    walk(document);
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /** Delivers an event to the plugin's hook. */
  async hook(event: PluginHook, entry: Partial<PluginEntryEvent['entry']> = {}): Promise<void> {
    if (!this.manifest.hooks.includes(event)) {
      throw new PluginTestError(`The manifest does not subscribe to ${event}.`);
    }
    const payload: PluginEntryEvent = {
      event,
      entry: {
        id: DEFAULT_ENTRY.id,
        type: 'post',
        title: 'Test entry',
        url: 'https://example.com/blog/test-entry',
        excerpt: '',
        publishedAt: new Date(0).toISOString(),
        ...entry,
      },
      occurredAt: new Date().toISOString(),
    };
    await this.run('hook', event, payload);
  }

  private async run(kind: 'shortcode' | 'hook', name: string, input: unknown): Promise<unknown> {
    const outcome = await this.engine.invoke(
      this.code,
      {
        kind,
        name,
        input,
        settings: resolvePluginSettings(this.manifest.settings, this.options.settings ?? {}),
        timeoutMs: this.options.timeoutMs ?? 2_000,
      },
      this.handler(),
    );
    this.logs.push(...outcome.logs);
    if (!outcome.result.ok) {
      throw new PluginTestError(`${kind} "${name}" failed: ${outcome.result.error.message}`);
    }
    return outcome.result.value;
  }

  private handler(): HostCallHandler {
    const permissions = this.manifest.permissions;
    return (method, args) => {
      switch (method) {
        case 'storage.get':
          return Promise.resolve(this.storage.get(String(args[0])) ?? null);
        case 'storage.set': {
          if (JSON.stringify(args[1] ?? null).length > STORAGE_VALUE_BYTES) {
            return Promise.reject(new Error('Values are limited to 16 KB.'));
          }
          this.storage.set(String(args[0]), structuredClone(args[1] ?? null));
          return Promise.resolve(null);
        }
        case 'storage.delete':
          this.storage.delete(String(args[0]));
          return Promise.resolve(null);
        case 'content.list': {
          if (!permissions.includes('content:read')) {
            return Promise.reject(new Error('Permission denied: content:read was not granted.'));
          }
          const query = pluginContentQuerySchema.parse(args[0] ?? {});
          const items = (this.options.content ?? []).filter(
            (item) =>
              (query.type === undefined || item.type === query.type) &&
              !(query.exclude ?? []).includes(item.id) &&
              (query.terms === undefined ||
                item.terms.some((term) => query.terms?.includes(`${term.taxonomy}:${term.slug}`))),
          );
          return Promise.resolve(items.slice(0, query.limit));
        }
        case 'content.get': {
          if (!permissions.includes('content:read')) {
            return Promise.reject(new Error('Permission denied: content:read was not granted.'));
          }
          return Promise.resolve(
            (this.options.content ?? []).find((item) => item.id === args[0]) ?? null,
          );
        }
        case 'http.fetch': {
          if (!permissions.includes('http:fetch')) {
            return Promise.reject(new Error('Permission denied: http:fetch was not granted.'));
          }
          const url = String(args[0]);
          const init = (args[1] ?? {}) as FetchInit;
          let host: string;
          try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:')
              throw new Error('Only https:// addresses are allowed.');
            host = parsed.hostname;
          } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error('Invalid URL.'));
          }
          if (!this.manifest.hosts.includes(host)) {
            return Promise.reject(new Error(`The host ${host} is not approved for this plugin.`));
          }
          this.requests.push({ url, init });
          if (!this.options.fetch)
            return Promise.reject(new Error('No fetch handler in the test.'));
          return Promise.resolve(this.options.fetch(url, init));
        }
        default:
          return Promise.reject(new Error(`Unknown method ${method}.`));
      }
    };
  }
}

/** Loads a plugin folder (validated like an upload) into a test harness. */
export async function loadPlugin(
  directory: string,
  options: HarnessOptions = {},
): Promise<PluginHarness> {
  const plugin = readPluginDirectory(directory);
  const engine = await PluginEngine.create();
  return new PluginHarness(plugin.manifest, plugin.code, engine, options);
}
