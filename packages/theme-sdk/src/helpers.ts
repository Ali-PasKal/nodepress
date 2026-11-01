import { isSafeLinkHref } from '@nexora/shared';

/** "%title% – %site%" → "Hello – My Site". */
export function formatTitle(template: string, title: string, siteName: string): string {
  if (title === '') return siteName;
  return template.replaceAll('%title%', title).replaceAll('%site%', siteName).trim();
}

/** Long date in the site's language (Persian sites get the Persian calendar, as Intl does by default). */
export function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(date);
  }
}

/** Absolute http(s) link to another site. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export interface LinkAttributes {
  href: string;
  target?: '_blank';
  rel?: string;
}

/**
 * Attributes for a link from content or menus: unsafe URLs (javascript:, data:, protocol-relative …)
 * are dropped and links opening a new tab never get a handle on this page.
 */
export function linkAttributes(href: string, openInNewTab = false): LinkAttributes | null {
  if (!isSafeLinkHref(href)) return null;
  const attributes: LinkAttributes = { href };
  if (openInNewTab) attributes.target = '_blank';
  if (openInNewTab || isExternalHref(href)) attributes.rel = 'noopener noreferrer';
  return attributes;
}

/** Whether a menu link points to the current page (or, for sections, one of its sub-pages). */
export function isCurrentLink(href: string, currentPath: string, matchSection = false): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  const path = href.split(/[?#]/)[0] ?? href;
  const decoded = safeDecode(path);
  if (decoded === currentPath) return true;
  return matchSection && decoded !== '/' && currentPath.startsWith(`${decoded}/`);
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Reading time in minutes at 200 words per minute (at least 1). */
export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
