import { isSafeImageSrc, type DeliveryMedia } from '@nexora/shared';

export interface ResponsiveImageProps {
  media: DeliveryMedia;
  /** The `sizes` attribute ("(min-width: 48rem) 48rem, 100vw"). */
  sizes?: string;
  /** Overrides the media library's alternative text (empty string marks a decorative image). */
  alt?: string;
  className?: string;
  /** Eager loading for images above the fold (the first featured image). */
  priority?: boolean;
}

/** `<img>` with width-based `srcset` from the media variants and intrinsic dimensions against layout shift. */
export function ResponsiveImage({
  media,
  sizes,
  alt,
  className,
  priority = false,
}: ResponsiveImageProps) {
  if (!isSafeImageSrc(media.url)) return null;
  const sources = media.sources.filter((source) => isSafeImageSrc(source.url));
  const candidates = sources.map((source) => `${source.url} ${String(source.width)}w`);
  const original =
    media.width !== null && !sources.some((source) => source.width >= (media.width ?? 0));
  if (original && media.width !== null && sources.length > 0) {
    candidates.push(`${media.url} ${String(media.width)}w`);
  }
  return (
    <img
      src={media.url}
      srcSet={candidates.length > 0 ? candidates.join(', ') : undefined}
      sizes={candidates.length > 0 ? (sizes ?? '100vw') : undefined}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      alt={alt ?? media.altText}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : {})}
    />
  );
}
