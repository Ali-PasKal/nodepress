import type {
  DeliveryArchive,
  DeliveryEntry,
  DeliveryListing,
  DeliverySite,
  ThemeManifest,
  ThemeSettingValues,
} from '@nexora/shared';
import type { ReactElement } from 'react';

/** What the current page shows. Redirects never reach a theme. */
export type ThemeView =
  | { kind: 'home'; listing: DeliveryListing | null; entry: DeliveryEntry | null }
  | { kind: 'entry'; entry: DeliveryEntry }
  | { kind: 'archive'; archive: DeliveryArchive; listing: DeliveryListing }
  | { kind: 'not_found' };

export interface ThemeRenderContext {
  readonly site: DeliverySite;
  readonly view: ThemeView;
  /** Decoded path of the request ("/blog/hello"), e.g. to mark the current menu item. */
  readonly path: string;
  /** True when rendering a preview link (the theme shows a notice). */
  readonly preview: boolean;
  /** URL of another page of the current listing ("/blog?page=2"). */
  pageUrl(page: number): string;
}

/**
 * A theme as the site runtime loads it. Themes render the page body with React; the runtime owns the
 * document head (titles, SEO and social tags, structured data, stylesheets) and the security headers.
 */
export interface ThemeModule {
  readonly manifest: ThemeManifest;
  /** Absolute path of the theme's stylesheet on disk (served with a content hash). */
  readonly stylesheet: string;
  /** CSS custom properties derived from validated settings ({"--accent": "#1d4ed8"}). */
  cssVariables(settings: ThemeSettingValues): Record<string, string>;
  /** Extra attributes for the <html> element; only `data-*` names are used. */
  htmlAttributes(settings: ThemeSettingValues): Record<string, string>;
  /** Renders the page body. */
  render(context: ThemeRenderContext): ReactElement;
}

export function defineTheme(theme: ThemeModule): ThemeModule {
  return theme;
}
