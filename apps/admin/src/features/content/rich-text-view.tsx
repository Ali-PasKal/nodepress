import type { RichTextBlock, RichTextDocument, RichTextInline, RichTextMark } from '@nexora/shared';
import { isSafeImageSrc, isSafeLinkHref } from '@nexora/shared';
import type { ReactNode } from 'react';

/**
 * Read-only rendering of a stored rich-text document as React elements. No HTML strings are involved:
 * React escapes all text, and links and images are re-checked against the same allowlist as the API.
 */
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
      case 'link':
        return isSafeLinkHref(mark.attrs.href) ? (
          <a
            key={markKey}
            href={mark.attrs.href}
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {child}
          </a>
        ) : (
          child
        );
    }
    return child;
  }, text);
}

function renderInline(node: RichTextInline, key: string): ReactNode {
  return node.type === 'hardBreak' ? <br key={key} /> : renderMarks(node.text, node.marks, key);
}

function renderChildren(content: RichTextBlock['content'], key: string): ReactNode[] {
  return (content ?? []).map((child, index) => renderNode(child, `${key}.${String(index)}`));
}

function renderNode(node: RichTextBlock | RichTextInline, key: string): ReactNode {
  if (node.type === 'text' || node.type === 'hardBreak') return renderInline(node, key);
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(node.content, key)}</p>;
    case 'heading': {
      const level = Number(attrs.level);
      const Tag =
        level === 2 ? 'h2' : level === 3 ? 'h3' : level === 4 ? 'h4' : level === 5 ? 'h5' : 'h6';
      return <Tag key={key}>{renderChildren(node.content, key)}</Tag>;
    }
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node.content, key)}</blockquote>;
    case 'bulletList':
      return <ul key={key}>{renderChildren(node.content, key)}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={typeof attrs.start === 'number' ? attrs.start : undefined}>
          {renderChildren(node.content, key)}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{renderChildren(node.content, key)}</li>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>
            {(node.content ?? [])
              .map((child) => (child.type === 'text' ? child.text : ''))
              .join('')}
          </code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      return isSafeImageSrc(src) ? (
        <img
          key={key}
          src={src}
          alt={typeof attrs.alt === 'string' ? attrs.alt : ''}
          loading="lazy"
        />
      ) : null;
    }
  }
  return null;
}

export function RichTextView({
  document,
  className,
}: {
  document: RichTextDocument;
  className?: string;
}) {
  if (document.content.length === 0) {
    return <p className="text-sm text-muted-foreground">No content.</p>;
  }
  return (
    <div className={`nx-prose ${className ?? ''}`}>
      {document.content.map((node, index) => renderNode(node, String(index)))}
    </div>
  );
}
