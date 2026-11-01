import { Button } from '@nexora/ui';
import { CheckCircle2, CircleX, Loader2 } from 'lucide-react';
import type { UploadItem } from './use-upload-queue';

export function UploadList({
  items,
  onClear,
}: {
  items: readonly UploadItem[];
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const finished = items.some((item) => item.status !== 'uploading');
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" aria-live="polite">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 text-sm" data-testid="upload-item">
            {item.status === 'uploading' ? (
              <Loader2
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            ) : item.status === 'done' ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleX className="size-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.status === 'uploading' && (
              <progress
                className="h-2 w-24 accent-[var(--color-primary)]"
                max={1}
                value={item.progress}
                aria-label={`Uploading ${item.name}`}
              />
            )}
            {item.status === 'done' && <span className="text-muted-foreground">Uploaded</span>}
            {item.status === 'error' && <span className="text-danger">{item.error}</span>}
          </li>
        ))}
      </ul>
      {finished && (
        <Button variant="ghost" size="sm" className="self-end" onClick={onClear}>
          Clear finished
        </Button>
      )}
    </div>
  );
}
