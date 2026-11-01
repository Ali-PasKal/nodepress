import { themeManifestSchema, type ThemeManifest } from '@nexora/shared';

/**
 * Manifest of the starter theme. Plain data (no React), so the API can import it to validate settings
 * without loading any rendering code.
 */
export const manifest: ThemeManifest = themeManifestSchema.parse({
  key: 'starter',
  name: 'Starter',
  version: '1.0.0',
  description:
    'A clean, fast theme for blogs and small sites: responsive, accessible, light and dark, right-to-left ready, with no client-side JavaScript.',
  author: 'NEXORA',
  settings: [
    {
      key: 'accentColor',
      type: 'color',
      label: 'Accent colour',
      description: 'Links, buttons and highlights.',
      default: '#1d4ed8',
    },
    {
      key: 'colorScheme',
      type: 'select',
      label: 'Colour scheme',
      options: [
        { value: 'auto', label: 'Follow the visitor’s system setting' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      default: 'auto',
    },
    {
      key: 'fontFamily',
      type: 'select',
      label: 'Typeface',
      options: [
        { value: 'system', label: 'System sans-serif' },
        { value: 'serif', label: 'Serif' },
        { value: 'rounded', label: 'Rounded' },
      ],
      default: 'system',
    },
    {
      key: 'contentWidth',
      type: 'select',
      label: 'Content width',
      options: [
        { value: 'narrow', label: 'Narrow (best for reading)' },
        { value: 'normal', label: 'Normal' },
        { value: 'wide', label: 'Wide' },
      ],
      default: 'normal',
    },
    {
      key: 'logo',
      type: 'media',
      label: 'Logo',
      description: 'Shown in the header instead of the site name.',
    },
    {
      key: 'showTagline',
      type: 'boolean',
      label: 'Show the tagline in the header',
      default: true,
    },
    {
      key: 'footerText',
      type: 'text',
      label: 'Footer text',
      description: 'For example a copyright line. Plain text.',
      maxLength: 300,
      default: '',
    },
  ],
  menuLocations: [
    { key: 'primary', label: 'Header navigation' },
    { key: 'footer', label: 'Footer links' },
  ],
});
