import { createRedirectSchema, REDIRECT_STATUS_CODES, type RedirectInfo } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nexora/ui';
import { ArrowRight, CircleX, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useState, type SyntheticEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/forms';
import { useDeleteRedirect, useRedirects, useSaveRedirect, type RedirectFilters } from './api';

const STATUS_LABELS: Record<number, string> = {
  301: '301 Moved permanently',
  302: '302 Found (temporary)',
  307: '307 Temporary redirect',
  308: '308 Permanent redirect',
};

function RedirectDialog({
  redirect,
  open,
  onOpenChange,
}: {
  redirect: RedirectInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState({
    fromPath: redirect?.fromPath ?? '',
    toPath: redirect?.toPath ?? '',
    statusCode: redirect?.statusCode ?? 301,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveRedirect();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = createRedirectSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    save.mutate(redirect ? { id: redirect.id, body: parsed.data } : { body: parsed.data }, {
      onSuccess: () => {
        toast.success(redirect ? 'Redirect updated.' : 'Redirect created.');
        onOpenChange(false);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.issues.length > 0) {
          setErrors(Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message])));
        } else {
          toast.error(errorMessage(error));
        }
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{redirect ? 'Edit redirect' : 'Add redirect'}</DialogTitle>
          <DialogDescription>
            Visitors (and search engines) requesting the old path are sent to the new address.
            Entries published at the old path take precedence.
          </DialogDescription>
        </DialogHeader>
        <form id="redirect-form" noValidate className="flex flex-col gap-4" onSubmit={submit}>
          <Field
            label="Old path"
            description='A path on this site, e.g. "/old-page".'
            error={errors.fromPath}
          >
            {(control) => (
              <Input
                {...control}
                value={values.fromPath}
                placeholder="/old-page"
                onChange={(event) => {
                  setValues({ ...values, fromPath: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="New address"
            description='A path on this site ("/new-page") or a full http(s) URL.'
            error={errors.toPath}
          >
            {(control) => (
              <Input
                {...control}
                value={values.toPath}
                placeholder="/new-page"
                onChange={(event) => {
                  setValues({ ...values, toPath: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Type" error={errors.statusCode}>
            {(control) => (
              <NativeSelect
                {...control}
                value={values.statusCode}
                onChange={(event) => {
                  setValues({
                    ...values,
                    statusCode: Number(event.target.value) as RedirectInfo['statusCode'],
                  });
                }}
              >
                {REDIRECT_STATUS_CODES.map((code) => (
                  <option key={code} value={code}>
                    {STATUS_LABELS[code]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" form="redirect-form" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {redirect ? 'Save redirect' : 'Add redirect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RedirectsPage() {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<RedirectFilters['source']>('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const list = useRedirects({ search: deferred, source, page });
  const [editing, setEditing] = useState<RedirectInfo | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RedirectInfo | null>(null);
  const remove = useDeleteRedirect();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Redirects"
        description="Automatic redirects are recorded when a published entry or a term moves; add your own for old or external links."
        actions={
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden="true" />
            Add redirect
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search redirects"
            placeholder="Search paths"
            className="ps-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Source"
          className="sm:w-48"
          value={source}
          onChange={(event) => {
            setSource(event.target.value as RedirectFilters['source']);
            setPage(1);
          }}
        >
          <option value="">All redirects</option>
          <option value="manual">Manual</option>
          <option value="auto">Automatic</option>
        </NativeSelect>
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <Alert tone="danger">
          <CircleX aria-hidden="true" />
          <AlertDescription>{errorMessage(list.error)}</AlertDescription>
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={deferred || source ? 'No matching redirects' : 'No redirects yet'}
          description="Redirects appear here when published content moves, or when you add one."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[12rem] break-all font-mono text-xs sm:max-w-xs">
                      {item.fromPath}
                    </TableCell>
                    <TableCell className="max-w-[12rem] break-all font-mono text-xs sm:max-w-xs">
                      <span className="inline-flex items-start gap-1">
                        <ArrowRight
                          className="mt-0.5 size-3 shrink-0 rtl:rotate-180"
                          aria-hidden="true"
                        />
                        {item.toPath}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="flex flex-wrap gap-1">
                        <Badge>{item.statusCode}</Badge>
                        <Badge tone={item.source === 'auto' ? 'info' : 'neutral'}>
                          {item.source === 'auto' ? 'Automatic' : 'Manual'}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {formatDateTime(item.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit redirect from ${item.fromPath}`}
                          onClick={() => {
                            setEditing(item);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete redirect from ${item.fromPath}`}
                          onClick={() => {
                            setDeleting(item);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      {editing !== null && (
        <RedirectDialog
          key={editing === 'new' ? 'new' : editing.id}
          redirect={editing === 'new' ? null : editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this redirect?"
        description={
          deleting ? `Requests for ${deleting.fromPath} will no longer be redirected.` : ''
        }
        confirmLabel="Delete redirect"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Redirect deleted.');
              setDeleting(null);
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </div>
  );
}
