import { Injectable } from '@nestjs/common';
import type { ThemeManifest } from '@nexora/shared';
import { manifest as starter } from '@nexora/theme-starter/manifest';
import { ApiException } from '../../common/errors/api-exception.js';

export const DEFAULT_THEME_KEY = starter.key;

/**
 * Installed themes. Themes are code packages that ship with the application; installing third-party
 * themes belongs to the extension system (later milestone), so this list is static.
 */
@Injectable()
export class ThemeRegistry {
  private readonly themes: ReadonlyMap<string, ThemeManifest> = new Map([[starter.key, starter]]);

  list(): ThemeManifest[] {
    return [...this.themes.values()];
  }

  require(key: string): ThemeManifest {
    const theme = this.themes.get(key);
    if (!theme) {
      throw new ApiException(404, 'NOT_FOUND', 'Theme not found.');
    }
    return theme;
  }

  /** The theme to render with: the stored key, or the default theme if that theme is not installed. */
  resolve(key: string): ThemeManifest {
    return this.themes.get(key) ?? starter;
  }
}
