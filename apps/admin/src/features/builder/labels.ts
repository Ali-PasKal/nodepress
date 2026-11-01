import { parseShortcodes, validateShortcode, type BuilderWidget } from '@nexora/shared';

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

/** Problems with shortcodes in a text, as the editor shows them (the site shows such shortcodes literally). */
export function shortcodeProblems(text: string): string[] {
  return parseShortcodes(text).flatMap((segment) => {
    if (segment.type !== 'shortcode') return [];
    const result = validateShortcode(segment);
    return result.ok ? [] : [result.reason];
  });
}
