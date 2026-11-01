import {
  parseShortcodes,
  validateShortcode,
  type ResolvedShortcode,
  type ShortcodeToken,
} from '@nexora/shared';
import { Fragment, type ReactNode } from 'react';
import { formatDate, linkAttributes } from './helpers.js';
import { ResponsiveImage } from './image.js';

/** What shortcodes need at render time: data resolved by the API plus a little site context. */
export interface ShortcodeContext {
  readonly resolved: Readonly<Record<string, ResolvedShortcode>>;
  readonly siteName: string;
  readonly language: string;
  /** Rendering time (the [year] shortcode); injectable for tests. */
  readonly now?: Date;
  /** Editor canvas: show placeholders for videos and for data that is only resolved on the site. */
  readonly editing?: boolean;
}

/** Labelled box the editor canvas shows instead of third-party frames or server-resolved data. */
export function EditPlaceholder({ label }: { label: string }) {
  return (
    <span className="nx-edit-placeholder" role="img" aria-label={label}>
      {label}
    </span>
  );
}

/** Shortcodes that render block content; a paragraph containing one is rendered as a <div>. */
const BLOCK_SHORTCODES = new Set(['recent_posts', 'gallery', 'video']);

export function hasBlockShortcode(text: string): boolean {
  return parseShortcodes(text).some(
    (segment) =>
      segment.type === 'shortcode' &&
      BLOCK_SHORTCODES.has(segment.name) &&
      validateShortcode(segment).ok,
  );
}

export function VideoFrame({
  provider,
  id,
  title,
  aspectRatio = '16:9',
}: {
  provider: 'youtube' | 'vimeo';
  id: string;
  title: string;
  aspectRatio?: string;
}) {
  const src =
    provider === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
      : `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1`;
  return (
    <div className={`nx-video nx-ratio-${aspectRatio.replace(':', '-')}`}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      />
    </div>
  );
}

/** One shortcode occurrence; anything that cannot be rendered stays as its literal source text. */
export function Shortcode({
  token,
  context,
}: {
  token: ShortcodeToken;
  context: ShortcodeContext;
}): ReactNode {
  const result = validateShortcode(token);
  if (!result.ok) return token.raw;
  const shortcode = result.value;
  switch (shortcode.name) {
    case 'site_name':
      return context.siteName;
    case 'year':
      return String((context.now ?? new Date()).getFullYear());
    case 'button': {
      const attributes = linkAttributes(shortcode.attrs.url, shortcode.attrs.new_tab);
      return attributes ? (
        <a {...attributes} className={`nx-btn nx-btn-${shortcode.attrs.style}`}>
          {shortcode.attrs.text}
        </a>
      ) : (
        token.raw
      );
    }
    case 'video':
      if (context.editing) return <EditPlaceholder label={`Video: ${shortcode.attrs.title}`} />;
      return (
        <VideoFrame
          provider={shortcode.attrs.youtube ? 'youtube' : 'vimeo'}
          id={shortcode.attrs.youtube ?? shortcode.attrs.vimeo ?? ''}
          title={shortcode.attrs.title}
        />
      );
    case 'recent_posts': {
      const data = context.resolved[shortcode.key];
      if (data?.name !== 'recent_posts') {
        return context.editing ? (
          <EditPlaceholder label="Recent posts (shown on the site)" />
        ) : null;
      }
      return (
        <ul className="nx-sc-posts">
          {data.items.map((item) => (
            <li key={item.id}>
              <a href={item.url}>{item.title}</a>{' '}
              <time dateTime={item.publishedAt}>
                {formatDate(item.publishedAt, context.language)}
              </time>
            </li>
          ))}
        </ul>
      );
    }
    case 'gallery': {
      const data = context.resolved[shortcode.key];
      if (data?.name !== 'gallery') {
        return context.editing ? <EditPlaceholder label="Gallery (shown on the site)" /> : null;
      }
      return (
        <div className={`nx-gallery nx-cols-${String(shortcode.attrs.columns)}`}>
          {data.media.map((media) => (
            <figure key={media.id}>
              <ResponsiveImage media={media} sizes="(min-width: 48rem) 33vw, 100vw" />
            </figure>
          ))}
        </div>
      );
    }
  }
}

/** Text with its shortcodes rendered (literal text when no context is given). */
export function ShortcodeText({
  text,
  context,
}: {
  text: string;
  context: ShortcodeContext | undefined;
}) {
  if (!context) return text;
  return (
    <>
      {parseShortcodes(text).map((segment, index) =>
        segment.type === 'text' ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <Fragment key={index}>
            <Shortcode token={segment} context={context} />
          </Fragment>
        ),
      )}
    </>
  );
}
