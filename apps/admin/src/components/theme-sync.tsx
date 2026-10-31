import { useEffect } from 'react';
import { resolveTheme, useThemeStore } from '../stores/theme-store';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Applies the theme preference to <html> and follows OS changes while the preference is "system". */
export function ThemeSync() {
  const preference = useThemeStore((state) => state.preference);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const theme = resolveTheme(preference, media.matches);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [preference]);

  return null;
}
