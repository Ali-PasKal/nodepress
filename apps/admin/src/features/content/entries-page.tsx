import type { ContentTypeInfo, EntrySummary, TaxonomyInfo } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
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
  cn,
} from '@nexora/ui';
import { CircleX, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';
import { NotFoundPage } from '../../routes/not-found-page';
import { useCapabilities } from '../auth/session';
import {
  useBulkEntries,
  useContentModel,
  useEntries,
  useEntryAction,
  useTerms,
  type EntryFilters,
} from './api';
import { EntryStatusBadge } from './status-badge';

const TABS: { value: EntryFilters['status']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'trash', label: 'Trash' },
];

type BulkAction = 'publish' | 'draft' | 'trash' | 'restore' | 'delete';

function TermFilter({
  taxonomy,
  value,
  onChange,
}: {
  taxonomy: TaxonomyInfo;
  value: string;
  onChange: (termId: string) => void;
}) {
  const terms = useTerms(taxonomy.id, '', 200);
  return (
    <NativeSelect
      aria-label={`Filter by ${taxonomy.name.toLowerCase()}`}
      className="sm:w-44"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">All {taxonomy.pluralName.toLowerCase()}</option>
      {(terms.data?.items ?? []).map((term) => (
        <option key={term.id} value={term.id}>
          {term.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function EntriesList({ type, taxonomies }: { type: ContentTypeInfo; taxonomies: TaxonomyInfo[] }) {
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<EntryFilters>({
    type: type.key,
    status: 'all',
    search: '',
    termId: '',
    page: 1,
    sort: 'updated',
  });
  const deferredSearch = useDeferredValue(filters.search.trim());
  const entries = useEntries({ ...filters, search: deferredSearch });
  const bulk = useBulkEntries();
  const action = useEntryAction();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<
    { kind: 'bulk'; action: BulkAction } | { kind: 'delete'; entry: EntrySummary } | null
  >(null);
  const canCreate = capabilities.has('content.create');
  const inTrash = filters.status === 'trash';
  const items = entries.data?.items ?? [];
  const singular = type.name.toLowerCase();
  const plural = type.pluralName.toLowerCase();

  const setFilter = (patch: Partial<EntryFilters>) => {
    setFilters((current) => ({ ...current, page: 1, ...patch }));
    setSelected(new Set());
  };

  const runBulk = (bulkAction: BulkAction) => {
    bulk.mutate(
      { action: bulkAction, ids: [...selected] },
      {
        onSuccess: (result) => {
          setSelected(new Set());
          if (result.failed.length === 0) {
            toast.success(
              `${String(result.succeeded.length)} ${result.succeeded.length === 1 ? singular : plural} updated.`,
            );
          } else {
            toast.warning(
              `${String(result.succeeded.length)} updated, ${String(result.failed.length)} skipped: ${result.failed[0]?.message ?? ''}`,
            );
          }
        },
        onError: (error) => toast.error(errorMessage(error)),
        onSettled: () => {
          setConfirm(null);
        },
      },
    );
  };

  const singleAction = (entry: EntrySummary, kind: 'trash' | 'restore' | 'delete') => {
    action.mutate(
      { id: entry.id, action: kind },
      {
        onSuccess: () =>
          toast.success(
            kind === 'trash'
              ? `Moved “${entry.title || '(no title)'}” to the trash.`
              : kind === 'restore'
                ? `Restored “${entry.title || '(no title)'}”.`
                : `Deleted “${entry.title || '(no title)'}” permanently.`,
          ),
        onError: (error) => toast.error(errorMessage(error)),
        onSettled: () => {
          setConfirm(null);
        },
      },
    );
  };

  const allSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));
  const bulkActions: { action: BulkAction; label: string }[] = inTrash
    ? [
        { action: 'restore', label: 'Restore' },
        { action: 'delete', label: 'Delete permanently' },
      ]
    : [
        ...(capabilities.has('content.publish')
          ? [
              { action: 'publish' as const, label: 'Publish' },
              { action: 'draft' as const, label: 'Revert to draft' },
            ]
          : []),
        ...(capabilities.has('content.delete')
          ? [{ action: 'trash' as const, label: 'Move to trash' }]
          : []),
      ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={type.pluralName}
        description={type.description || undefined}
        actions={
          canCreate && (
            <Button asChild>
              <Link to={`/content/${type.key}/new`}>
                <Plus aria-hidden="true" /> New {singular}
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div
          className="flex flex-wrap gap-1 border-b px-2 pt-2"
          role="group"
          aria-label="Filter by status"
        >
          {TABS.map((tab) => {
            const count = entries.data?.counts[tab.value];
            const active = filters.status === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFilter({ status: tab.value });
                }}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {count !== undefined && (
                  <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label={`Search ${plural}`}
              placeholder={`Search ${plural}`}
              className="pl-9"
              value={filters.search}
              onChange={(event) => {
                setFilter({ search: event.target.value });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            {taxonomies.map((taxonomy) => (
              <TermFilter
                key={taxonomy.id}
                taxonomy={taxonomy}
                value={filters.termId}
                onChange={(termId) => {
                  setFilter({ termId });
                }}
              />
            ))}
            <NativeSelect
              aria-label="Sort"
              className="sm:w-40"
              value={filters.sort}
              onChange={(event) => {
                setFilter({ sort: event.target.value as EntryFilters['sort'] });
              }}
            >
              <option value="updated">Last updated</option>
              <option value="published">Publish date</option>
              <option value="title">Title</option>
            </NativeSelect>
          </div>
        </div>
        {selected.size > 0 && bulkActions.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm"
            aria-live="polite"
          >
            <span className="font-medium">{selected.size} selected</span>
            {bulkActions.map((item) => (
              <Button
                key={item.action}
                size="sm"
                variant="outline"
                disabled={bulk.isPending}
                onClick={() => {
                  if (item.action === 'delete') setConfirm({ kind: 'bulk', action: 'delete' });
                  else runBulk(item.action);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}

        {entries.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label={`Loading ${plural}`}>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : entries.isError ? (
          <div className="p-4">
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(entries.error)}</AlertDescription>
            </Alert>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={
              filters.search || filters.termId
                ? `No ${plural} match these filters`
                : inTrash
                  ? 'The trash is empty'
                  : `No ${plural} yet`
            }
            action={
              canCreate &&
              !inTrash &&
              !filters.search && (
                <Button asChild variant="outline">
                  <Link to={`/content/${type.key}/new`}>
                    <Plus aria-hidden="true" /> New {singular}
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allSelected}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? new Set(items.map((entry) => entry.id))
                            : new Set(),
                        );
                      }}
                    />
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Author</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((entry) => (
                  <TableRow key={entry.id} data-testid="entry-row">
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${entry.title || 'untitled entry'}`}
                        checked={selected.has(entry.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(entry.id);
                          else next.delete(entry.id);
                          setSelected(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="flex min-w-0 items-center gap-3">
                        {entry.featuredMedia && (
                          <img
                            src={entry.featuredMedia.thumbnailUrl}
                            alt=""
                            className="hidden size-10 shrink-0 rounded object-cover sm:block"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <Link
                            to={`/content/${type.key}/${entry.id}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {entry.title || (
                              <span className="italic text-muted-foreground">(no title)</span>
                            )}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">/{entry.path}</p>
                          {entry.terms.length > 0 && (
                            <div className="mt-1 hidden flex-wrap gap-1 md:flex">
                              {entry.terms.slice(0, 3).map((term) => (
                                <Badge key={term.id}>{term.name}</Badge>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 sm:hidden">
                            <EntryStatusBadge
                              status={entry.status}
                              trashed={entry.trashedAt !== null}
                            />
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {entry.author.displayName}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-col items-start gap-1">
                        <EntryStatusBadge
                          status={entry.status}
                          trashed={entry.trashedAt !== null}
                        />
                        {entry.status === 'scheduled' && (
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(entry.publishedAt)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDateTime(entry.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${entry.title || 'untitled entry'}`}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => void navigate(`/content/${type.key}/${entry.id}`)}
                          >
                            <Pencil aria-hidden="true" /> {entry.permissions.edit ? 'Edit' : 'View'}
                          </DropdownMenuItem>
                          {entry.permissions.trash && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => {
                                  singleAction(entry, 'trash');
                                }}
                              >
                                <Trash2 aria-hidden="true" /> Move to trash
                              </DropdownMenuItem>
                            </>
                          )}
                          {entry.permissions.restore && (
                            <DropdownMenuItem
                              onSelect={() => {
                                singleAction(entry, 'restore');
                              }}
                            >
                              <RotateCcw aria-hidden="true" /> Restore
                            </DropdownMenuItem>
                          )}
                          {entry.permissions.delete && (
                            <DropdownMenuItem
                              className="text-danger"
                              onSelect={() => {
                                setConfirm({ kind: 'delete', entry });
                              }}
                            >
                              <Trash2 aria-hidden="true" /> Delete permanently
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              className="border-t p-4"
              page={filters.page}
              pageSize={entries.data.pageSize}
              total={entries.data.total}
              onPageChange={(page) => {
                setFilters((current) => ({ ...current, page }));
              }}
            />
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === 'delete'
            ? `Delete “${confirm.entry.title || '(no title)'}” permanently?`
            : `Delete ${String(selected.size)} ${selected.size === 1 ? singular : plural} permanently?`
        }
        description="Deleted entries and their revisions cannot be recovered."
        confirmLabel="Delete permanently"
        destructive
        pending={bulk.isPending || action.isPending}
        onConfirm={() => {
          if (confirm?.kind === 'delete') singleAction(confirm.entry, 'delete');
          else runBulk('delete');
        }}
      />
    </div>
  );
}

export function EntriesPage() {
  const { type: typeKey } = useParams();
  const model = useContentModel();
  if (model.isPending) {
    return <Skeleton className="h-64" role="status" aria-label="Loading" />;
  }
  if (model.isError) {
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(model.error)}</AlertDescription>
      </Alert>
    );
  }
  const type = model.data.contentTypes.find((candidate) => candidate.key === typeKey);
  if (!type) return <NotFoundPage />;
  const taxonomies = model.data.taxonomies.filter((taxonomy) =>
    type.taxonomyIds.includes(taxonomy.id),
  );
  // Keyed by type so filters and selection reset when switching between content types.
  return <EntriesList key={type.key} type={type} taxonomies={taxonomies} />;
}
