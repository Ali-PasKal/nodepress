import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveThemeSettings, type ThemeSettingValues } from '@nexora/shared';
import type { ThemeModule } from '@nexora/theme-sdk';
import { theme as starter } from '@nexora/theme-starter/render';

export interface StaticAsset {
  readonly body: string;
  readonly contentType: string;
}

export interface LoadedTheme {
  readonly module: ThemeModule;
  readonly stylesheetHref: string;
}

const VAR_NAME = /^--[a-z][a-z0-9-]{0,40}$/;
// CSS values from theme settings: colours, lengths and font stacks. No url(), comments, escapes or
// anything that could end the declaration block.
const VAR_VALUE = /^[A-Za-z0-9 #%.,()'"+-]{1,300}$/;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 16);
}

/** Validated `:root { --name: value }` declarations; anything unsafe is dropped. */
export function variablesCss(variables: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(variables)
    .filter(
      ([name, value]) =>
        VAR_NAME.test(name) && VAR_VALUE.test(value) && !/url\(|expression\(/i.test(value),
    )
    .slice(0, 30)
    .map(([name, value]) => `${name}:${value}`);
  return `:root{${declarations.join(';')}}\n`;
}

/**
 * Installed themes and their static assets. Stylesheets are served under content-hashed names; the CSS
 * variables derived from theme settings are served as a small stylesheet whose URL carries the
 * variables themselves (so every instance can answer it), which keeps the pages free of inline styles.
 */
export class ThemeSet {
  private readonly themes = new Map<string, LoadedTheme>();
  private readonly assets = new Map<string, StaticAsset>();

  private constructor(private readonly fallbackKey: string) {}

  static async load(modules: readonly ThemeModule[] = [starter]): Promise<ThemeSet> {
    const first = modules[0];
    if (!first) throw new Error('At least one theme is required.');
    const set = new ThemeSet(first.manifest.key);
    for (const module of modules) {
      const css = await readFile(module.stylesheet, 'utf8');
      const name = `${module.manifest.key}.${hash(css)}.css`;
      set.assets.set(name, { body: css, contentType: 'text/css; charset=utf-8' });
      set.themes.set(module.manifest.key, { module, stylesheetHref: `/_assets/${name}` });
    }
    return set;
  }

  /** The active theme, or the default theme when the site names one this runtime does not have. */
  resolve(key: string): LoadedTheme {
    const theme = this.themes.get(key) ?? this.themes.get(this.fallbackKey);
    if (!theme) throw new Error('No theme loaded.');
    return theme;
  }

  /** Settings as the theme expects them (revalidated here; the runtime trusts no input blindly). */
  settingsFor(theme: LoadedTheme, delivered: unknown): ThemeSettingValues {
    return resolveThemeSettings(theme.module.manifest, delivered);
  }

  variablesHref(theme: LoadedTheme, settings: ThemeSettingValues): string {
    const css = variablesCss(theme.module.cssVariables(settings));
    return `/_assets/vars/${Buffer.from(css, 'utf8').toString('base64url')}.css`;
  }

  asset(name: string): StaticAsset | undefined {
    return this.assets.get(name);
  }

  /** Rebuilds a variables stylesheet from its URL, re-validating every declaration. */
  variablesAsset(encoded: string): StaticAsset | undefined {
    if (!/^[A-Za-z0-9_-]{1,4000}$/.test(encoded)) return undefined;
    const css = Buffer.from(encoded, 'base64url').toString('utf8');
    const match = /^:root\{(.*)\}\n$/s.exec(css);
    if (!match) return undefined;
    const body = match[1] ?? '';
    const variables: Record<string, string> = {};
    for (const declaration of body === '' ? [] : body.split(';')) {
      const index = declaration.indexOf(':');
      if (index <= 0) return undefined;
      variables[declaration.slice(0, index)] = declaration.slice(index + 1);
    }
    const rebuilt = variablesCss(variables);
    return rebuilt === css ? { body: rebuilt, contentType: 'text/css; charset=utf-8' } : undefined;
  }
}
