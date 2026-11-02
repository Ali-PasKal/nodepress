import {
  buildPluginShortcodeAttrsSchema,
  parseShortcodes,
  validateShortcode,
  type BuilderWidget,
  type PluginShortcodeDefinition,
} from '@nexora/shared';

export const DEVICE_WIDTHS = { desktop: '100%', tablet: '768px', mobile: '375px' } as const;

export type DragData =
  | { kind: 'section' }
  | { kind: 'widget'; columnId: string }
  | { kind: 'column'; columnId: string }
  | { kind: 'new'; widget: BuilderWidget['widget'] };

const WIDGET_LABELS: Record<BuilderWidget['widget'], string> = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  spacer: 'Spacer',
  divider: 'Divider',
  video: 'Video',
  posts: 'Posts',
  shortcode: 'Shortcode',
  html: 'HTML embed',
};
export function widgetLabel(type: BuilderWidget['widget']): string {
  return WIDGET_LABELS[type];
}

/** Extracts a video id from a pasted URL (youtube.com/watch?v=…, youtu.be/…, vimeo.com/…) or returns the input. */
export function videoIdFrom(provider: 'youtube' | 'vimeo', input: string): string {
  const value = input.trim();
  if (provider === 'youtube') {
    const match = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(value);
    return match?.[1] ?? value;
  }
  const match = /vimeo\.com\/(?:video\/)?(\d{6,12})/.exec(value);
  return match?.[1] ?? value;
}

/**
 * Problems with shortcodes in a text, as the editor shows them (the site shows such shortcodes literally).
 * Shortcodes of active plugins are accepted when their attributes match the plugin's declared types.
 */
export function shortcodeProblems(
  text: string,
  pluginShortcodes: readonly PluginShortcodeDefinition[] = [],
): string[] {
  return parseShortcodes(text).flatMap((segment) => {
    if (segment.type !== 'shortcode') return [];
    const result = validateShortcode(segment);
    if (result.ok) return [];
    const plugin = pluginShortcodes.find((definition) => definition.name === segment.name);
    if (!plugin) return [result.reason];
    const attrs = buildPluginShortcodeAttrsSchema(plugin).safeParse(segment.attrs);
    if (attrs.success) return [];
    const issue = attrs.error.issues[0];
    const field = issue?.path[0];
    return [
      `Invalid ${field === undefined ? 'attributes' : `"${String(field)}"`} for [${segment.name}]${issue ? `: ${issue.message}` : ''}.`,
    ];
  });
}
