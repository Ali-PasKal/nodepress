import type { MediaItem } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Label,
  NativeSelect,
  Pagination,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Textarea,
  cn,
} from '@nexora/ui';
import { Copy, ExternalLink, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { useDeferredValue, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';
import { useCapabilities } from '../auth/session';
import {
  formatBytes,
  useDeleteMedia,
  useMediaItem,
  useMediaList,
  useUpdateMedia,
  type MediaFilters,
} from './api';
import { MediaThumb } from './media-thumb';
import { UploadList } from './upload-list';
import { useUploadQueue } from './use-upload-queue';
import { useForm } from 'react-hook-form';

interface DetailsForm {
  title: string;
  altText: string;
  caption: string;
}

function MediaDetails({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const item = useMediaItem(id);
  const update = useUpdateMedia();
  const remove = useDeleteMedia();
  const [confirming, setConfirming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<DetailsForm>({
    values: item.data
      ? { title: item.data.title, altText: item.data.altText, caption: item.data.caption }
      : { title: '', altText: '', caption: '' },
  });

  if (item.isPending) return <Skeleton className="h-64" />;
  if (item.isError) {
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(item.error)}</AlertDescription>
      </Alert>
    );
  }
  const media = item.data;
  const absoluteUrl = new URL(media.url, window.location.origin).href;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border bg-muted">
        {media.kind === 'image' ? (
          <img
            src={media.variants.at(-1)?.url ?? media.url}
            alt={media.altText}
            className="mx-auto max-h-72 object-contain"
          />
        ) : media.kind === 'video' ? (
          <video src={media.url} controls className="w-full" />
        ) : media.kind === 'audio' ? (
          <audio src={media.url} controls className="w-full p-4" />
        ) : (
          <div className="aspect-video">
            <MediaThumb item={media} />
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">File</dt>
        <dd className="truncate">{media.filename}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{media.mimeType}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>
          {formatBytes(media.sizeBytes)}
          {media.width !== null &&
            media.height !== null &&
            ` · ${String(media.width)} × ${String(media.height)}`}
        </dd>
        <dt className="text-muted-foreground">Uploaded</dt>
        <dd>
          {formatDateTime(media.createdAt)} by {media.uploader.displayName}
        </dd>
        <dt className="text-muted-foreground">Used in</dt>
        <dd>{media.usageCount === 1 ? '1 entry' : `${String(media.usageCount)} entries`}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(absoluteUrl).then(
              () => toast.success('Link copied.'),
              () => toast.error('Could not copy the link.'),
            );
          }}
        >
          <Copy aria-hidden="true" /> Copy link
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={media.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" /> Open
          </a>
        </Button>
      </div>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            setFormError(null);
            update.mutate(
              { id, input: values },
              {
                onSuccess: () => toast.success('Details saved.'),
                onError: (error) => {
                  setFormError(
                    applyServerErrors(error, form.setError, ['title', 'altText', 'caption']),
                  );
                },
              },
            );
          })(event)
        }
      >
        {formError && (
          <Alert tone="danger">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <fieldset disabled={!media.permissions.edit} className="flex flex-col gap-3">
          <Field label="Title" error={form.formState.errors.title?.message}>
            {(control) => <Input {...control} {...form.register('title')} />}
          </Field>
          {media.kind === 'image' && (
            <Field
              label="Alternative text"
              description="Describes the image for people who cannot see it. Leave empty for purely decorative images."
              error={form.formState.errors.altText?.message}
            >
              {(control) => <Textarea {...control} rows={2} {...form.register('altText')} />}
            </Field>
          )}
          <Field label="Caption" error={form.formState.errors.caption?.message}>
            {(control) => <Textarea {...control} rows={2} {...form.register('caption')} />}
          </Field>
        </fieldset>
        <div className="flex justify-between gap-2">
          {media.permissions.delete ? (
            <Button
              type="button"
              variant="outline"
              className="text-danger"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden="true" /> Delete
            </Button>
          ) : (
            <span />
          )}
          {media.permissions.edit && (
            <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
              {update.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save details
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${media.filename}?`}
        description={
          media.usageCount > 0
            ? `It is used in ${String(media.usageCount)} ${media.usageCount === 1 ? 'entry' : 'entries'}; those places will show nothing. This cannot be undone.`
            : 'This cannot be undone.'
        }
        confirmLabel="Delete file"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('File deleted.');
              setConfirming(false);
              onDeleted();
            },
            onError: (error) => {
              toast.error(errorMessage(error));
              setConfirming(false);
            },
          });
        }}
      />
    </div>
  );
}

export function MediaPage() {
  const capabilities = useCapabilities();
  const canUpload = capabilities.has('media.upload');
  const [filters, setFilters] = useState<MediaFilters>({
    search: '',
    kind: '',
    mine: false,
    page: 1,
  });
  const deferredSearch = useDeferredValue(filters.search.trim());
  const list = useMediaList({ ...filters, search: deferredSearch });
  const queue = useUploadQueue();
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (canUpload && event.dataTransfer.files.length > 0) void queue.add(event.dataTransfer.files);
  };

  return (
    <div
      className="flex flex-col gap-6"
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <PageHeader
        title="Media"
        description="Images, documents, audio and video for your content."
        actions={
          canUpload && (
            <>
              <input
                ref={input}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose files to upload"
                accept={queue.accept}
                onChange={(event) => {
                  if (event.target.files) void queue.add(event.target.files);
                  event.target.value = '';
                }}
              />
              <Button onClick={() => input.current?.click()}>
                <Upload aria-hidden="true" /> Upload files
              </Button>
            </>
          )
        }
      />
      {canUpload && (
        <div
          className={cn(
            'rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground transition-colors',
            dragging && 'border-primary bg-primary/5 text-foreground',
          )}
        >
          Drop files anywhere on this page to upload them.
        </div>
      )}
      <UploadList items={queue.items} onClear={queue.clearFinished} />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
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
              value={filters.search}
              onChange={(event) => {
                setFilters({ ...filters, search: event.target.value, page: 1 });
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            <NativeSelect
              aria-label="Filter by type"
              className="sm:w-40"
              value={filters.kind}
              onChange={(event) => {
                setFilters({
                  ...filters,
                  kind: event.target.value as MediaFilters['kind'],
                  page: 1,
                });
              }}
            >
              <option value="">All types</option>
              <option value="image">Images</option>
              <option value="document">Documents</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </NativeSelect>
            {canUpload && (
              <Label className="flex items-center gap-2 whitespace-nowrap font-normal">
                <Checkbox
                  checked={filters.mine}
                  onChange={(event) => {
                    setFilters({ ...filters, mine: event.target.checked, page: 1 });
                  }}
                />
                My uploads
              </Label>
            )}
          </div>
        </div>
        <div className="p-4">
          {list.isPending ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
              role="status"
              aria-label="Loading media"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <Skeleton key={index} className="aspect-square" />
              ))}
            </div>
          ) : list.isError ? (
            <Alert tone="danger">
              <AlertDescription>{errorMessage(list.error)}</AlertDescription>
            </Alert>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={
                filters.search || filters.kind || filters.mine
                  ? 'No files match these filters'
                  : 'The media library is empty'
              }
              description={
                canUpload
                  ? 'Upload images, PDFs, audio or video to use them in your content.'
                  : undefined
              }
            />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {list.data.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="group flex w-full flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setSelected(item);
                      }}
                      aria-label={`Details for ${item.title}`}
                      data-testid="media-item"
                    >
                      <span className="block aspect-square overflow-hidden rounded-lg border">
                        <MediaThumb item={item} />
                      </span>
                      <span className="truncate text-xs font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination
                className="mt-4"
                page={filters.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={(page) => {
                  setFilters({ ...filters, page });
                }}
              />
            </>
          )}
        </div>
      </Card>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-md"
          aria-describedby="media-details-description"
        >
          <div className="flex flex-col gap-4 p-4">
            <SheetTitle className="truncate pr-8">{selected?.title ?? 'File'}</SheetTitle>
            <SheetDescription id="media-details-description" className="sr-only">
              File details and settings
            </SheetDescription>
            {selected && (
              <MediaDetails
                key={selected.id}
                id={selected.id}
                onDeleted={() => {
                  setSelected(null);
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
