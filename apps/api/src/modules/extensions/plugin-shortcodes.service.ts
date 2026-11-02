import { Injectable } from '@nestjs/common';
import {
  buildPluginShortcodeAttrsSchema,
  parseShortcodes,
  pluginShortcodeOutputSchema,
  shortcodeKey,
  SHORTCODE_NAMES,
  type PluginEntryContext,
  type PluginShortcodeAttrs,
  type ResolvedShortcode,
  type RichTextDocument,
} from '@nexora/shared';
import type { z } from 'zod';
import { PluginRegistry, type ActivePlugin } from './plugin-registry.js';
import { PluginRuntimeService } from './plugin-runtime.service.js';

/** Plugin shortcode calls per entry, the deadline of each, and the time budget of a whole page. */
const MAX_CALLS = 10;
const CALL_TIMEOUT_MS = 500;
const PAGE_BUDGET_MS = 2_000;
const CACHE_MS = 30_000;
const CACHE_ENTRIES = 500;

const EMPTY: RichTextDocument = { type: 'doc', content: [] };

interface Registered {
  readonly plugin: ActivePlugin;
  readonly attrs: z.ZodType<PluginShortcodeAttrs>;
}

/**
 * Resolves plugin shortcodes for the Delivery API: finds them in the entry's texts, validates their attributes
 * against the plugin's declared types, runs the plugin's handler in its sandbox, and keeps the result only if
 * it is plain text or rich text that passes the allowlist. Shortcodes of inactive plugins are left alone (they
 * stay literal text); failures resolve to nothing so a broken plugin cannot break a page.
 */
@Injectable()
export class PluginShortcodesService {
  private readonly cache = new Map<string, { at: number; value: RichTextDocument }>();

  constructor(
    private readonly registry: PluginRegistry,
    private readonly runtime: PluginRuntimeService,
  ) {}

  async resolve(
    siteId: string,
    texts: readonly string[],
    entry: PluginEntryContext,
  ): Promise<Record<string, ResolvedShortcode>> {
    if (!this.runtime.enabled) return {};
    const plugins = await this.registry.active(siteId);
    if (plugins.length === 0) return {};
    const registered = new Map<string, Registered>();
    for (const plugin of plugins) {
      for (const definition of plugin.manifest.shortcodes) {
        if ((SHORTCODE_NAMES as readonly string[]).includes(definition.name)) continue;
        registered.set(definition.name, {
          plugin,
          attrs: buildPluginShortcodeAttrsSchema(definition),
        });
      }
    }
    const calls = new Map<
      string,
      { registered: Registered; name: string; attrs: PluginShortcodeAttrs }
    >();
    for (const text of texts) {
      for (const segment of parseShortcodes(text)) {
        if (segment.type !== 'shortcode') continue;
        const found = registered.get(segment.name);
        if (!found) continue;
        const key = shortcodeKey(segment);
        if (calls.has(key) || calls.size >= MAX_CALLS) continue;
        const attrs = found.attrs.safeParse(segment.attrs);
        // Invalid attributes: the shortcode stays literal, as for core shortcodes.
        if (attrs.success)
          calls.set(key, { registered: found, name: segment.name, attrs: attrs.data });
      }
    }
    const resolved: Record<string, ResolvedShortcode> = {};
    const deadline = Date.now() + PAGE_BUDGET_MS;
    for (const [key, call] of calls) {
      const content =
        Date.now() < deadline
          ? await this.run(call.registered.plugin, call.name, call.attrs, entry, key)
          : EMPTY;
      resolved[key] = { name: 'plugin', plugin: call.registered.plugin.key, content };
    }
    return resolved;
  }

  private async run(
    plugin: ActivePlugin,
    name: string,
    attrs: PluginShortcodeAttrs,
    entry: PluginEntryContext,
    key: string,
  ): Promise<RichTextDocument> {
    const cacheKey = `${plugin.id}|${plugin.revision}|${entry.id}|${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const outcome = await this.runtime.invoke(plugin, {
      kind: 'shortcode',
      name,
      input: { attrs, entry },
      timeoutMs: CALL_TIMEOUT_MS,
    });
    let value = EMPTY;
    if (outcome.result.ok) {
      const output = pluginShortcodeOutputSchema.safeParse(outcome.result.value);
      if (!output.success) {
        void this.runtime.log(plugin.id, [
          {
            level: 'error',
            message: `shortcode "${name}" returned something other than text or allowed rich text; nothing is shown.`,
          },
        ]);
      } else {
        value =
          typeof output.data === 'string'
            ? output.data === ''
              ? EMPTY
              : {
                  type: 'doc',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: output.data }] }],
                }
            : output.data;
      }
    }
    if (this.cache.size >= CACHE_ENTRIES) this.cache.clear();
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
}
