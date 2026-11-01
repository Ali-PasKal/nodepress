import type { MediaItem } from '@nexora/shared';
import { FileAudio, FileText, FileVideo } from 'lucide-react';

/** Square preview: the image thumbnail, or an icon for other kinds of files. */
export function MediaThumb({ item }: { item: MediaItem }) {
  if (item.thumbnailUrl) {
    return (
      <img
        src={item.thumbnailUrl}
        alt={item.altText}
        loading="lazy"
        className="size-full object-cover"
        width={item.width ?? undefined}
        height={item.height ?? undefined}
      />
    );
  }
  const Icon = item.kind === 'video' ? FileVideo : item.kind === 'audio' ? FileAudio : FileText;
  return (
    <span className="flex size-full items-center justify-center bg-muted text-muted-foreground">
      <Icon className="size-8" aria-hidden="true" />
    </span>
  );
}
