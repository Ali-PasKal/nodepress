import {
  parseShortcodes,
  type BuilderColumn,
  type BuilderDocument,
  type BuilderSection,
  type BuilderWidget,
  type DeliveryEntryCard,
  type DeliveryMedia,
} from '@nexora/shared';
import { Fragment, type HTMLAttributes, type ReactNode } from 'react';
import { formatDate, linkAttributes } from './helpers.js';
import { ResponsiveImage } from './image.js';
import { RichText } from './rich-text.js';
import { EditPlaceholder, Shortcode, VideoFrame, type ShortcodeContext } from './shortcodes.js';

/**
 * Renders builder documents. The site runtime and the admin's editor canvas use the same widget components and
 * the same class names (plus the CSS compiled from the document), so the canvas looks like the published page.
 */
export interface BuilderRenderContext {
  /** Media referenced by image widgets and text widgets, keyed by id. */
  readonly media: Readonly<Record<string, DeliveryMedia>>;
  /** Entries for posts widgets, keyed by widget id. */
  readonly posts: Readonly<Record<string, readonly DeliveryEntryCard[]>>;
  readonly shortcodes: ShortcodeContext;
  /** URL of an HTML embed widget's sandboxed document (null in the editor, which shows a placeholder). */
  readonly embedUrl: ((widgetId: string) => string) | null;
}

export const builderClassNames = {
  root: 'nx-b',
  section: (section: BuilderSection) => `nx-b-section nx-b-${section.layout} nx-el-${section.id}`,
  row: 'nx-b-row',
  column: (column: BuilderColumn) => `nx-b-col nx-b-v-${column.verticalAlign} nx-el-${column.id}`,
};

function PostsGrid({
  items,
  columns,
  showImage,
  showExcerpt,
  showDate,
  language,
}: {
  items: readonly DeliveryEntryCard[];
  columns: number;
  showImage: boolean;
  showExcerpt: boolean;
  showDate: boolean;
  language: string;
}) {
  return (
    <div className={`nx-posts nx-cols-${String(columns)}`}>
      {items.map((item) => (
        <article key={item.id} className="nx-posts-item">
          {showImage && item.featuredMedia ? (
            <a href={item.url} tabIndex={-1} aria-hidden="true" className="nx-posts-image">
              <ResponsiveImage
                media={item.featuredMedia}
                alt=""
                sizes="(min-width: 48rem) 33vw, 100vw"
              />
            </a>
          ) : null}
          <h3 className="nx-posts-title">
            <a href={item.url}>{item.title}</a>
          </h3>
          {showDate ? (
            <time className="nx-posts-date" dateTime={item.publishedAt}>
              {formatDate(item.publishedAt, language)}
            </time>
          ) : null}
          {showExcerpt && item.summary !== '' ? (
            <p className="nx-posts-summary">{item.summary}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/** One widget, rendered as a single root element carrying its `nx-el-<id>` class. */
export function WidgetView({
  widget,
  context,
  rootProps = {},
}: {
  widget: BuilderWidget;
  context: BuilderRenderContext;
  /** Extra attributes for the root element (the editor adds selection handlers). */
  rootProps?: HTMLAttributes<HTMLElement>;
}): ReactNode {
  const base = `nx-w nx-w-${widget.widget} nx-el-${widget.id}`;
  const props = { ...rootProps, className: [base, rootProps.className].filter(Boolean).join(' ') };
  switch (widget.widget) {
    case 'heading': {
      const { text, level, link } = widget.props;
      const Tag = `h${String(level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const attributes = link ? linkAttributes(link) : null;
      return <Tag {...props}>{attributes ? <a {...attributes}>{text}</a> : text}</Tag>;
    }
    case 'text':
      return (
        <div {...props}>
          <RichText
            document={widget.props.content}
            media={context.media}
            shortcodes={context.shortcodes}
            imageSizes="(min-width: 64rem) 60vw, 100vw"
            className="nx-prose"
          />
        </div>
      );
    case 'image': {
      const media = widget.props.mediaId ? context.media[widget.props.mediaId] : undefined;
      const image = media ? (
        <ResponsiveImage
          media={media}
          alt={widget.props.alt !== '' ? widget.props.alt : media.altText}
          sizes="(min-width: 64rem) 60vw, 100vw"
        />
      ) : null;
      const attributes = widget.props.link ? linkAttributes(widget.props.link) : null;
      return (
        <figure {...props} className={`${props.className} nx-w-image-${widget.props.width}`}>
          {image && attributes ? <a {...attributes}>{image}</a> : image}
          {widget.props.caption !== '' ? <figcaption>{widget.props.caption}</figcaption> : null}
        </figure>
      );
    }
    case 'button': {
      const { label, url, variant, size, openInNewTab, fullWidth } = widget.props;
      const attributes = linkAttributes(url, openInNewTab);
      return (
        <div {...props}>
          {attributes ? (
            <a
              {...attributes}
              className={`nx-btn nx-btn-${variant} nx-btn-${size}${fullWidth ? ' nx-btn-block' : ''}`}
            >
              {label}
            </a>
          ) : null}
        </div>
      );
    }
    case 'spacer':
      return <div {...props} aria-hidden="true" />;
    case 'divider':
      return <hr {...props} />;
    case 'video':
      if (context.shortcodes.editing) {
        return (
          <div {...props}>
            <div className={`nx-video nx-ratio-${widget.props.aspectRatio.replace(':', '-')}`}>
              <EditPlaceholder
                label={`${widget.props.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video: ${widget.props.title}`}
              />
            </div>
          </div>
        );
      }
      return (
        <div {...props}>
          <VideoFrame
            provider={widget.props.provider}
            id={widget.props.videoId}
            title={widget.props.title}
            aspectRatio={widget.props.aspectRatio}
          />
        </div>
      );
    case 'posts':
      if (context.shortcodes.editing && !context.posts[widget.id]) {
        return (
          <div {...props}>
            <EditPlaceholder
              label={`Latest ${String(widget.props.count)} entries of "${widget.props.type}" (shown on the site)`}
            />
          </div>
        );
      }
      return (
        <div {...props}>
          <PostsGrid
            items={context.posts[widget.id] ?? []}
            columns={widget.props.columns}
            showImage={widget.props.showImage}
            showExcerpt={widget.props.showExcerpt}
            showDate={widget.props.showDate}
            language={context.shortcodes.language}
          />
        </div>
      );
    case 'shortcode':
      return (
        <div {...props}>
          {parseShortcodes(widget.props.code).map((segment, index) => (
            <Fragment key={index}>
              {segment.type === 'text' ? (
                segment.text
              ) : (
                <Shortcode token={segment} context={context.shortcodes} />
              )}
            </Fragment>
          ))}
        </div>
      );
    case 'html':
      return (
        <div {...props}>
          {context.shortcodes.editing ? (
            <EditPlaceholder
              label={`HTML embed: ${widget.props.title} (runs sandboxed on the site)`}
            />
          ) : context.embedUrl ? (
            <iframe
              src={context.embedUrl(widget.id)}
              title={widget.props.title}
              height={widget.props.height}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-popups allow-forms"
              className="nx-embed"
            />
          ) : null}
        </div>
      );
  }
}

/** The whole document (sections → columns → widgets). */
export function BuilderContent({
  document,
  context,
}: {
  document: BuilderDocument;
  context: BuilderRenderContext;
}) {
  return (
    <div className={builderClassNames.root}>
      {document.sections.map((section) => (
        <section key={section.id} className={builderClassNames.section(section)}>
          <div className={builderClassNames.row}>
            {section.children.map((column) => (
              <div key={column.id} className={builderClassNames.column(column)}>
                {column.children.map((widget) => (
                  <WidgetView key={widget.id} widget={widget} context={context} />
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
