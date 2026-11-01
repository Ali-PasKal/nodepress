import {
  isSafeImageSrc,
  type DeliveryMedia,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextInline,
  type RichTextMark,
} from '@nexora/shared';
import type { ReactNode } from 'react';
import { linkAttributes } from './helpers.js';
import { ResponsiveImage } from './image.js';

/**
 * Renders a stored rich-text document as React elements. No HTML strings are involved: React escapes
 * all text, and links and images are re-checked against the same allowlist the API enforces on save.
 */
interface RenderOptions {
  readonly media: Readonly<Record<string, DeliveryMedia>>;
  readonly imageSizes: string;
}

function renderMarks(
  text: ReactNode,
  marks: readonly RichTextMark[] | undefined,
  key: string,
): ReactNode {
  return (marks ?? []).reduce<ReactNode>((child, mark, index) => {
    const markKey = `${key}-${String(index)}`;
    switch (mark.type) {
      case 'bold':
        return <strong key={markKey}>{child}</strong>;
      case 'italic':
        return <em key={markKey}>{child}</em>;
      case 'underline':
        return <u key={markKey}>{child}</u>;
      case 'strike':
        return <s key={markKey}>{child}</s>;
      case 'code':
        return <code key={markKey}>{child}</code>;
      case 'link': {
        const attributes = linkAttributes(mark.attrs.href, mark.attrs.target === '_blank');
        return attributes ? (
          <a key={markKey} {...attributes}>
            {child}
          </a>
        ) : (
          child
        );
      }
    }
    return child;
  }, text);
}

function renderChildren(
  content: RichTextBlock['content'],
  key: string,
  options: RenderOptions,
): ReactNode[] {
  return (content ?? []).map((child, index) =>
    renderNode(child, `${key}.${String(index)}`, options),
  );
}

const ORDERED_LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I']);

function renderNode(
  node: RichTextBlock | RichTextInline,
  key: string,
  options: RenderOptions,
): ReactNode {
  if (node.type === 'text') return renderMarks(node.text, node.marks, key);
  if (node.type === 'hardBreak') return <br key={key} />;
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(node.content, key, options)}</p>;
    case 'heading': {
      const level = Number(attrs.level);
      const Tag =
        level === 2 ? 'h2' : level === 3 ? 'h3' : level === 4 ? 'h4' : level === 5 ? 'h5' : 'h6';
      return <Tag key={key}>{renderChildren(node.content, key, options)}</Tag>;
    }
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node.content, key, options)}</blockquote>;
    case 'bulletList':
      return <ul key={key}>{renderChildren(node.content, key, options)}</ul>;
    case 'orderedList': {
      const type =
        typeof attrs.type === 'string' && ORDERED_LIST_TYPES.has(attrs.type)
          ? attrs.type
          : undefined;
      return (
        <ol
          key={key}
          start={typeof attrs.start === 'number' && attrs.start !== 1 ? attrs.start : undefined}
          type={type as '1' | 'a' | 'A' | 'i' | 'I' | undefined}
        >
          {renderChildren(node.content, key, options)}
        </ol>
      );
    }
    case 'listItem':
      return <li key={key}>{renderChildren(node.content, key, options)}</li>;
    case 'codeBlock': {
      const language =
        typeof attrs.language === 'string' && /^[a-z0-9+#-]{1,32}$/i.test(attrs.language)
          ? attrs.language
          : null;
      return (
        <pre key={key}>
          <code className={language ? `language-${language}` : undefined}>
            {(node.content ?? [])
              .map((child) => (child.type === 'text' ? child.text : ''))
              .join('')}
          </code>
        </pre>
      );
    }
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      const alt = typeof attrs.alt === 'string' ? attrs.alt : '';
      const title = typeof attrs.title === 'string' && attrs.title !== '' ? attrs.title : null;
      const media = typeof attrs.mediaId === 'string' ? options.media[attrs.mediaId] : undefined;
      const image = media ? (
        <ResponsiveImage media={media} alt={alt} sizes={options.imageSizes} />
      ) : isSafeImageSrc(src) ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : null;
      if (!image) return null;
      return (
        <figure key={key}>
          {image}
          {title ? <figcaption>{title}</figcaption> : null}
        </figure>
      );
    }
  }
  return null;
}

export interface RichTextProps {
  document: RichTextDocument;
  /** Media referenced by image nodes (from the delivered entry), for responsive images. */
  media?: Readonly<Record<string, DeliveryMedia>>;
  /** `sizes` for images in the body. */
  imageSizes?: string;
  className?: string;
}

export function RichText({ document, media = {}, imageSizes = '100vw', className }: RichTextProps) {
  const options: RenderOptions = { media, imageSizes };
  return (
    <div className={className}>
      {document.content.map((node, index) => renderNode(node, String(index), options))}
    </div>
  );
}
