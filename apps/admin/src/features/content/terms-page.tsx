import { slugify, type TaxonomyInfo, type TermInfo } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@nexora/ui';
import { CircleX, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { NotFoundPage } from '../../routes/not-found-page';
import { useContentModel, useDeleteTerm, useSaveTerm, useTerms } from './api';
import { orderTerms } from './term-order';

interface TermForm {
  name: string;
  slug: string;
  parentId: string;
  description: string;
}

function TermDialogBody({
  taxonomy,
  term,
  terms,
  onDone,
}: {
  taxonomy: TaxonomyInfo;
  term: TermInfo | null;
  terms: readonly TermInfo[];
  onDone: () => void;
}) {
  const save = useSaveTerm();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TermForm>({
    defaultValues: {
      name: term?.name ?? '',
      slug: term?.slug ?? '',
      parentId: term?.parentId ?? '',
      description: term?.description ?? '',
    },
  });
  const name = useWatch({ control: form.control, name: 'name' });
  // A term cannot move under itself or its own descendants.
  const excluded = new Set<string>();
  if (term) {
    excluded.add(term.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of terms) {
        if (candidate.parentId && excluded.has(candidate.parentId) && !excluded.has(candidate.id)) {
          excluded.add(candidate.id);
          grew = true;
        }
      }
    }
  }
  const parents = orderTerms(terms).filter(({ term: candidate }) => !excluded.has(candidate.id));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setFormError(null);
          const body = {
            name: values.name.trim(),
            ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
            parentId: taxonomy.hierarchical && values.parentId ? values.parentId : null,
            description: values.description,
          };
          save.mutate(term ? { id: term.id, body } : { taxonomyId: taxonomy.id, body }, {
            onSuccess: (saved) => {
              toast.success(term ? `${saved.name} was updated.` : `${saved.name} was created.`);
              onDone();
            },
            onError: (error) => {
              setFormError(
                applyServerErrors(error, form.setError, [
                  'name',
                  'slug',
                  'parentId',
                  'description',
                ]),
              );
            },
          });
        })(event)
      }
    >
      {formError && (
        <Alert tone="danger">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <Field label="Name" error={form.formState.errors.name?.message}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            {...form.register('name', {
              required: 'Name is required.',
              maxLength: { value: 200, message: 'Use at most 200 characters.' },
            })}
          />
        )}
      </Field>
      <Field
        label="Slug"
        description={`Leave empty to derive it from the name (${slugify(name) || 'term'}).`}
        error={form.formState.errors.slug?.message}
      >
        {(control) => (
          <Input {...control} className="font-mono text-sm" {...form.register('slug')} />
        )}
      </Field>
      {taxonomy.hierarchical && (
        <Field label="Parent" error={form.formState.errors.parentId?.message}>
          {(control) => (
            <NativeSelect {...control} {...form.register('parentId')}>
              <option value="">(none — top level)</option>
              {parents.map(({ term: candidate, depth }) => (
                <option key={candidate.id} value={candidate.id}>
                  {'— '.repeat(depth)}
                  {candidate.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      <Field label="Description" error={form.formState.errors.description?.message}>
        {(control) => <Textarea {...control} rows={3} {...form.register('description')} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {term ? 'Save changes' : `Add ${taxonomy.name.toLowerCase()}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TermsManager({ taxonomy }: { taxonomy: TaxonomyInfo }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const all = useTerms(taxonomy.id);
  const filtered = useTerms(deferred ? taxonomy.id : null, deferred);
  const remove = useDeleteTerm();
  const [editing, setEditing] = useState<TermInfo | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TermInfo | null>(null);
  const singular = taxonomy.name.toLowerCase();
  const allTerms = all.data?.items ?? [];
  const rows = deferred
    ? (filtered.data?.items ?? []).map((term) => ({ term, depth: 0 }))
    : orderTerms(allTerms);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={taxonomy.pluralName}
        description={taxonomy.description || undefined}
        actions={
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden="true" /> Add {singular}
          </Button>
        }
      />
      <Card>
        <div className="border-b p-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label={`Search ${taxonomy.pluralName.toLowerCase()}`}
              placeholder={`Search ${taxonomy.pluralName.toLowerCase()}`}
              className="pl-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </div>
        </div>
        {all.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : all.isError ? (
          <div className="p-4">
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(all.error)}</AlertDescription>
            </Alert>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              deferred
                ? `No ${taxonomy.pluralName.toLowerCase()} match “${deferred}”`
                : `No ${taxonomy.pluralName.toLowerCase()} yet`
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Slug</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ term, depth }) => (
                <TableRow key={term.id} data-testid="term-row">
                  <TableCell>
                    <span
                      style={{ paddingInlineStart: `${String(depth * 1.25)}rem` }}
                      className="font-medium"
                    >
                      {depth > 0 && <span className="text-muted-foreground">— </span>}
                      {term.name}
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                    {term.slug}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{term.entryCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${term.name}`}
                        onClick={() => {
                          setEditing(term);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${term.name}`}
                        onClick={() => {
                          setDeleting(term);
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
        )}
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? `Add ${singular}` : `Edit ${editing?.name ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {taxonomy.hierarchical
                ? `${taxonomy.pluralName} can be nested under a parent.`
                : `${taxonomy.pluralName} are free-form keywords.`}
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <TermDialogBody
              taxonomy={taxonomy}
              term={editing === 'new' ? null : editing}
              terms={allTerms}
              onDone={() => {
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? singular}?`}
        description={
          deleting && deleting.entryCount > 0
            ? `It is assigned to ${String(deleting.entryCount)} ${deleting.entryCount === 1 ? 'entry' : 'entries'}, which will lose it.${taxonomy.hierarchical ? ' Its children move up one level.' : ''}`
            : taxonomy.hierarchical
              ? 'Its children move up one level.'
              : 'This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(`${deleting.name} was deleted.`),
            onError: (error) => toast.error(errorMessage(error)),
            onSettled: () => {
              setDeleting(null);
            },
          });
        }}
      />
    </div>
  );
}

export function TermsPage() {
  const { taxonomy: key } = useParams();
  const model = useContentModel();
  if (model.isPending) return <Skeleton className="h-64" role="status" aria-label="Loading" />;
  if (model.isError) {
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(model.error)}</AlertDescription>
      </Alert>
    );
  }
  const taxonomy = model.data.taxonomies.find((candidate) => candidate.key === key);
  if (!taxonomy) return <NotFoundPage />;
  return <TermsManager key={taxonomy.id} taxonomy={taxonomy} />;
}
