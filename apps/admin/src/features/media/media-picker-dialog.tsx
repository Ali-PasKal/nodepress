import type { MediaItem, MediaKind } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Pagination,
  Skeleton,
  cn,
} from '@nexora/ui';
import { Search, Upload } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { errorMessage } from '../../lib/forms';
import { useCapabilities } from '../auth/session';
import { useMediaList } from './api';
import { MediaThumb } from './media-thumb';
import { UploadList } from './upload-list';
import { useUploadQueue } from './use-upload-queue';

interface MediaPickerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (item: MediaItem) => void;
  readonly kind?: MediaKind;
  readonly title?: string;
}

function PickerBody({ kind, onSelect }: { kind?: MediaKind; onSelect: (item: MediaItem) => void }) {
  const capabilities = useCapabilities();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const list = useMediaList({
    search: deferred,
    kind: kind ?? '',
    mine: false,
    page,
    pageSize: 24,
  });
  const queue = useUploadQueue((media) => {
    if (!kind || media.kind === kind) onSelect(media);
  });
  const input = useRef<HTMLInputElement>(null);
  const canUpload = capabilities.has('media.upload');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search media"
            placeholder="Search by name or description"
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload a file"
              accept={kind === 'image' ? 'image/*' : queue.accept}
              onChange={(event) => {
                if (event.target.files) void queue.add(event.target.files);
                event.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Upload aria-hidden="true" /> Upload
            </Button>
          </>
        )}
      </div>
      <UploadList items={queue.items} onClear={queue.clearFinished} />
      {list.isPending ? (
        <div
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          role="status"
          aria-label="Loading media"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="aspect-square" />
          ))}
        </div>
      ) : list.isError ? (
        <Alert tone="danger">
          <AlertDescription>{errorMessage(list.error)}</AlertDescription>
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No files found"
          description={canUpload ? 'Upload a file to use it here.' : undefined}
        />
      ) : (
        <>
          <ul className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {list.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-md border',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  aria-label={`Choose ${item.title}`}
                  onClick={() => {
                    onSelect(item);
                  }}
                >
                  <MediaThumb item={item} />
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

/** Choose a file from the media library (or upload one) without leaving the current screen. */
export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
  kind,
  title,
}: MediaPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {title ?? (kind === 'image' ? 'Choose an image' : 'Choose a file')}
          </DialogTitle>
          <DialogDescription>
            Pick a file from the media library, or upload a new one.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PickerBody
            {...(kind ? { kind } : {})}
            onSelect={(item) => {
              onSelect(item);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
