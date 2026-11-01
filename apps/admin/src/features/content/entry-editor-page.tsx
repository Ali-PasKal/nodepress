import {
  buildFieldValuesSchema,
  EMPTY_RICH_TEXT,
  richTextDocumentSchema,
  slugify,
  type ContentTypeInfo,
  type EntryDetail,
  type EntrySeo,
  type EntryStatus,
  type RichTextDocument,
  type TaxonomyInfo,
  type UpdateEntryInput,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@nexora/ui';
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  History,
  ImageIcon,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';
import { NotFoundPage } from '../../routes/not-found-page';
import { useCapabilities } from '../auth/session';
import { MediaPickerDialog } from '../media/media-picker-dialog';
import {
  useContentModel,
  useCreateEntry,
  useEntries,
  useEntry,
  useEntryAction,
  useFetchLatestEntry,
  usePreviewLink,
  useRestoreRevision,
  useRevision,
  useRevisions,
  useUpdateEntry,
} from './api';
import { FieldInputs } from './field-inputs';
import { RichTextEditor, type PickedImage } from './rich-text-editor';
import { RichTextView } from './rich-text-view';
import { EntryStatusBadge } from './status-badge';
import { CategoryChecklist, TagInput } from './term-pickers';

interface FormValues {
  seo: EntrySeo;
  title: string;
  slug: string;
  excerpt: string;
  body: RichTextDocument;
  fields: Record<string, unknown>;
  termIds: string[];
  featuredMediaId: string | null;
  parentId: string | null;
}

type Intent = 'save' | 'publish' | 'schedule' | 'submit' | 'unpublish';

/** Stable serialisation (sorted keys) for change detection. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

const EMPTY_SEO: EntrySeo = { title: '', description: '', noindex: false };

function valuesFrom(entry: EntryDetail | null): FormValues {
  return entry
    ? {
        seo: entry.seo,
        title: entry.title,
        slug: entry.slug,
        excerpt: entry.excerpt,
        body: entry.body,
        fields: entry.fields,
        termIds: [...entry.termIds].sort(),
        featuredMediaId: entry.featuredMedia?.id ?? null,
        parentId: entry.parentId,
      }
    : {
        seo: EMPTY_SEO,
        title: '',
        slug: '',
        excerpt: '',
        body: EMPTY_RICH_TEXT,
        fields: {},
        termIds: [],
        featuredMediaId: null,
        parentId: null,
      };
}

/** "2026-11-01T14:30" in local time, for <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 3_600_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ParentSelect({
  type,
  entry,
  value,
  onChange,
  disabled,
  error,
}: {
  type: ContentTypeInfo;
  entry: EntryDetail | null;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const candidates = useEntries({
    type: type.key,
    status: 'all',
    search: '',
    termId: '',
    page: 1,
    sort: 'title',
    pageSize: 100,
  });
  const options = (candidates.data?.items ?? [])
    .filter((item) => !entry || (item.id !== entry.id && !item.path.startsWith(`${entry.path}/`)))
    .sort((a, b) => a.path.localeCompare(b.path));
  return (
    <Field label={`Parent ${type.name.toLowerCase()}`} error={error}>
      {(control) => (
        <NativeSelect
          {...control}
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) => {
            onChange(event.target.value || null);
          }}
        >
          <option value="">(none — top level)</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {'— '.repeat(item.path.split('/').length - 1)}
              {item.title || '(no title)'}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

function RevisionsDialog({
  entry,
  open,
  onOpenChange,
  canRestore,
  dirty,
  onRestored,
}: {
  entry: EntryDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  dirty: boolean;
  onRestored: (entry: EntryDetail) => void;
}) {
  const revisions = useRevisions(entry.id, open);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const revision = useRevision(entry.id, selectedId);
  const restore = useRestoreRevision(entry.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Revisions</DialogTitle>
          <DialogDescription>
            Every save is kept as a revision. Restoring one saves it as the newest version.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-hidden md:grid-cols-[16rem_1fr]">
          <ul className="flex flex-col gap-1 overflow-y-auto" aria-label="Revision list">
            {revisions.isPending && <Skeleton className="h-24" />}
            {revisions.data?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                  }}
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted aria-pressed:bg-muted"
                >
                  <span className="block font-medium">
                    Version {item.entryVersion}
                    {item.entryVersion === entry.version && ' (current)'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt)} · {item.author.displayName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 overflow-y-auto rounded-lg border p-4">
            {selectedId === null ? (
              <p className="text-sm text-muted-foreground">Select a revision to see its content.</p>
            ) : revision.isPending ? (
              <Skeleton className="h-40" />
            ) : revision.isError ? (
              <Alert tone="danger">
                <AlertDescription>{errorMessage(revision.error)}</AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold">
                  {revision.data.snapshot.title || '(no title)'}
                </h3>
                <p className="text-xs text-muted-foreground">/{revision.data.snapshot.slug}</p>
                {revision.data.snapshot.excerpt && (
                  <p className="text-sm italic">{revision.data.snapshot.excerpt}</p>
                )}
                <RichTextView document={revision.data.snapshot.body} />
                {canRestore && revision.data.entryVersion !== entry.version && (
                  <div>
                    <Button
                      onClick={() => {
                        setConfirming(true);
                      }}
                      disabled={restore.isPending}
                    >
                      <RotateCcw aria-hidden="true" /> Restore this version
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Restore this version?"
          description={
            dirty
              ? 'Your unsaved changes will be discarded. The restored content is saved as a new revision.'
              : 'The restored content is saved as a new revision; nothing is lost.'
          }
          confirmLabel="Restore"
          pending={restore.isPending}
          onConfirm={() => {
            if (!selectedId) return;
            restore.mutate(
              { revisionId: selectedId, version: entry.version },
              {
                onSuccess: (restored) => {
                  toast.success('Revision restored.');
                  setConfirming(false);
                  onOpenChange(false);
                  onRestored(restored);
                },
                onError: (error) => {
                  setConfirming(false);
                  toast.error(errorMessage(error));
                },
              },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Search appearance: overrides for the page title and description, and opting out of indexing. */
function SeoPanel({
  seo,
  title,
  excerpt,
  url,
  disabled,
  errors,
  onChange,
}: {
  seo: EntrySeo;
  title: string;
  excerpt: string;
  url: string | null;
  disabled: boolean;
  errors: Record<string, string>;
  onChange: (seo: EntrySeo) => void;
}) {
  const shownTitle = seo.title || title || 'Untitled';
  const shownDescription = seo.description || excerpt;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Search appearance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="rounded-md border bg-muted/40 p-3 text-sm"
          aria-label="Search result preview"
        >
          <p className="truncate text-xs text-muted-foreground">{url ?? 'Not public'}</p>
          <p className="truncate font-medium text-primary">{shownTitle}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {shownDescription || 'No description: search engines pick text from the page.'}
          </p>
        </div>
        <Field
          label="SEO title"
          description={`${String(seo.title.length)}/200 · empty uses the title; about 60 characters show in results.`}
          error={errors['seo.title']}
        >
          {(control) => (
            <Input
              {...control}
              value={seo.title}
              maxLength={200}
              disabled={disabled}
              placeholder={title}
              onChange={(event) => {
                onChange({ ...seo, title: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          label="Meta description"
          description={`${String(seo.description.length)}/320 · empty uses the excerpt.`}
          error={errors['seo.description']}
        >
          {(control) => (
            <Textarea
              {...control}
              value={seo.description}
              maxLength={320}
              disabled={disabled}
              placeholder={excerpt}
              onChange={(event) => {
                onChange({ ...seo, description: event.target.value });
              }}
            />
          )}
        </Field>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={seo.noindex}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...seo, noindex: event.target.checked });
            }}
          />
          Hide from search engines (noindex)
        </Label>
      </CardContent>
    </Card>
  );
}

function EntryEditor({
  type,
  taxonomies,
  initial,
}: {
  type: ContentTypeInfo;
  taxonomies: TaxonomyInfo[];
  initial: EntryDetail | null;
}) {
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const entryAction = useEntryAction();
  const previewLink = usePreviewLink();
  const fetchLatest = useFetchLatestEntry();
  const [reloading, setReloading] = useState(false);
  const [entry, setEntry] = useState<EntryDetail | null>(initial);
  const [baseline, setBaseline] = useState<FormValues>(() => valuesFrom(initial));
  const [values, setValues] = useState<FormValues>(() => valuesFrom(initial));
  const [editorKey, setEditorKey] = useState(0);
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [scheduling, setScheduling] = useState(entry?.status === 'scheduled');
  const [publishAt, setPublishAt] = useState(() =>
    toLocalInput(entry?.status === 'scheduled' ? entry.publishedAt : null),
  );
  const [featured, setFeatured] = useState<{ url: string; alt: string } | null>(
    initial?.featuredMedia
      ? { url: initial.featuredMedia.thumbnailUrl, alt: initial.featuredMedia.altText }
      : null,
  );
  const [termNames, setTermNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.terms ?? []).map((term) => [term.id, term.name])),
  );
  /** Which taxonomy each known term belongs to, so tag inputs only show their own terms. */
  const [termTaxonomy, setTermTaxonomy] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.terms ?? []).map((term) => [term.id, term.taxonomyId])),
  );
  const [pickingFeatured, setPickingFeatured] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const imagePicker = useRef<((image: PickedImage | null) => void) | null>(null);
  const [pickingInline, setPickingInline] = useState(false);
  const skipBlock = useRef(false);

  const permissions = entry?.permissions;
  const canPublish = entry ? (permissions?.publish ?? false) : capabilities.has('content.publish');
  const editable = entry ? (permissions?.edit ?? false) : capabilities.has('content.create');
  const saving = create.isPending || update.isPending;
  const dirty = useMemo(() => stable(values) !== stable(baseline), [values, baseline]);
  const singular = type.name.toLowerCase();

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !skipBlock.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const set = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)),
    );
  };

  const adopt = (saved: EntryDetail) => {
    const next = valuesFrom(saved);
    setEntry(saved);
    setBaseline(next);
    setValues(next);
    setSlugTouched(true);
    setScheduling(saved.status === 'scheduled');
    setTermNames((current) => ({
      ...current,
      ...Object.fromEntries(saved.terms.map((term) => [term.id, term.name])),
    }));
    setFeatured(
      saved.featuredMedia
        ? { url: saved.featuredMedia.thumbnailUrl, alt: saved.featuredMedia.altText }
        : null,
    );
  };

  const handleError = (error: unknown) => {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      error.message.includes('changed by someone else')
    ) {
      setConflict(true);
      return;
    }
    if (error instanceof ApiError && error.issues.length > 0) {
      const mapped: Record<string, string> = {};
      const unattached: string[] = [];
      for (const issue of error.issues) {
        const known =
          [
            'title',
            'slug',
            'excerpt',
            'publishedAt',
            'parentId',
            'termIds',
            'featuredMediaId',
            'body',
            'seo.title',
            'seo.description',
          ].includes(issue.path) || issue.path.startsWith('fields.');
        if (known) mapped[issue.path] = issue.message;
        else unattached.push(issue.message);
      }
      setErrors(mapped);
      setFormError(unattached[0] ?? null);
      return;
    }
    setFormError(errorMessage(error));
  };

  const save = (intent: Intent) => {
    setFormError(null);
    const clientErrors: Record<string, string> = {};
    const fieldCheck = buildFieldValuesSchema(type.fields).safeParse(values.fields);
    if (!fieldCheck.success) {
      for (const issue of fieldCheck.error.issues)
        clientErrors[`fields.${issue.path.join('.')}`] = issue.message;
    }
    if (type.hasBody && !richTextDocumentSchema.safeParse(values.body).success) {
      clientErrors.body =
        'The content contains something that cannot be saved. Remove unsupported elements and try again.';
    }
    if (intent !== 'save' && intent !== 'unpublish' && values.title.trim() === '') {
      clientErrors.title = 'Add a title before submitting, scheduling or publishing.';
    }
    const scheduledFor = intent === 'schedule' ? new Date(publishAt) : null;
    if (
      scheduledFor &&
      (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now())
    ) {
      clientErrors.publishedAt = 'Choose a future date and time.';
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    const status: EntryStatus | undefined =
      intent === 'publish'
        ? 'published'
        : intent === 'schedule'
          ? 'scheduled'
          : intent === 'submit'
            ? 'pending'
            : intent === 'unpublish'
              ? 'draft'
              : undefined;
    const publishedAt = scheduledFor ? scheduledFor.toISOString() : undefined;

    if (!entry) {
      create.mutate(
        {
          type: type.key,
          title: values.title,
          ...(slugTouched && values.slug ? { slug: values.slug } : {}),
          excerpt: values.excerpt,
          body: values.body,
          fields: values.fields,
          termIds: values.termIds,
          featuredMediaId: values.featuredMediaId,
          parentId: values.parentId,
          seo: values.seo,
          status: status ?? 'draft',
          ...(publishedAt ? { publishedAt } : {}),
        },
        {
          onSuccess: (created) => {
            toast.success(
              created.status === 'published' ? `${type.name} published.` : `${type.name} saved.`,
            );
            adopt(created);
            skipBlock.current = true;
            void navigate(`/content/${type.key}/${created.id}`, { replace: true });
          },
          onError: handleError,
        },
      );
      return;
    }

    // Send only what changed (plus the version that guards against concurrent edits).
    const input: UpdateEntryInput = { version: entry.version };
    (Object.keys(values) as (keyof FormValues)[]).forEach((key) => {
      if (stable(values[key]) !== stable(baseline[key])) {
        Object.assign(input, { [key]: values[key] });
      }
    });
    if (status) input.status = status;
    if (publishedAt) input.publishedAt = publishedAt;
    update.mutate(
      { id: entry.id, input },
      {
        onSuccess: (saved) => {
          adopt(saved);
          toast.success(
            saved.status === 'published' && entry.status !== 'published'
              ? `${type.name} published.`
              : saved.status === 'scheduled' && intent === 'schedule'
                ? `${type.name} scheduled for ${formatDateTime(saved.publishedAt)}.`
                : `${type.name} saved.`,
          );
        },
        onError: handleError,
      },
    );
  };

  const pickInlineImage = () =>
    new Promise<PickedImage | null>((resolve) => {
      imagePicker.current = resolve;
      setPickingInline(true);
    });

  const trashed = Boolean(entry?.trashedAt);
  const parentPath = type.hierarchical && values.parentId ? '…/' : '';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={entry ? entry.title || `Untitled ${singular}` : `New ${singular}`}
        actions={
          <Button variant="ghost" asChild>
            <Link to={`/content/${type.key}`}>
              <ArrowLeft aria-hidden="true" /> All {type.pluralName.toLowerCase()}
            </Link>
          </Button>
        }
      />
      {conflict && (
        <Alert tone="warning">
          <AlertTitle>Someone else changed this {singular}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Your changes were not saved. Load the latest version to continue (your unsaved changes
              will be discarded).
            </span>
            <span>
              <Button
                size="sm"
                variant="outline"
                disabled={reloading || !entry}
                onClick={() => {
                  if (!entry) return;
                  setReloading(true);
                  fetchLatest(entry.id)
                    .then((latest) => {
                      adopt(latest);
                      setEditorKey((key) => key + 1);
                      setConflict(false);
                    })
                    .catch((error: unknown) => toast.error(errorMessage(error)))
                    .finally(() => {
                      setReloading(false);
                    });
                }}
              >
                Load latest version
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {trashed && entry && (
        <Alert tone="warning">
          <AlertTitle>This {singular} is in the trash</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>Restore it to edit it again.</span>
            {permissions?.restore && (
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    entryAction.mutate(
                      { id: entry.id, action: 'restore' },
                      {
                        onSuccess: (restored) => {
                          if (restored) adopt(restored);
                          toast.success('Restored from the trash.');
                        },
                        onError: (error) => toast.error(errorMessage(error)),
                      },
                    );
                  }}
                >
                  <RotateCcw aria-hidden="true" /> Restore
                </Button>
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
      {!editable && !trashed && entry && (
        <Alert tone="info">
          <AlertDescription>You can view this {singular} but not change it.</AlertDescription>
        </Alert>
      )}
      {formError && (
        <Alert tone="danger">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <fieldset disabled={!editable || trashed} className="flex min-w-0 flex-col gap-4">
          <Field label="Title" error={errors.title}>
            {(control) => (
              <Input
                {...control}
                className="h-11 text-lg font-medium"
                value={values.title}
                placeholder={`${type.name} title`}
                onChange={(event) => {
                  const title = event.target.value;
                  setValues((current) => ({
                    ...current,
                    title,
                    ...(slugTouched ? {} : { slug: slugify(title) }),
                  }));
                }}
              />
            )}
          </Field>
          <Field
            label="Slug"
            description={`Address: /${parentPath}${values.slug || '…'}`}
            error={errors.slug}
          >
            {(control) => (
              <Input
                {...control}
                className="font-mono text-sm"
                value={values.slug}
                placeholder="generated-from-the-title"
                onChange={(event) => {
                  setSlugTouched(true);
                  set('slug', event.target.value.toLowerCase());
                }}
              />
            )}
          </Field>
          {type.hasBody && (
            <div className="flex flex-col gap-1.5">
              <Label>Content</Label>
              <RichTextEditor
                key={editorKey}
                label={`${type.name} content`}
                value={values.body}
                invalid={errors.body !== undefined}
                onChange={(body) => {
                  set('body', body);
                }}
                {...(capabilities.has('media.upload') || capabilities.has('media.manage')
                  ? { onPickImage: pickInlineImage }
                  : {})}
              />
              {errors.body && <p className="text-xs font-medium text-danger">{errors.body}</p>}
            </div>
          )}
          {type.hasExcerpt && (
            <Field
              label="Excerpt"
              description="A short summary shown in lists and search results."
              error={errors.excerpt}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={1000}
                  value={values.excerpt}
                  onChange={(event) => {
                    set('excerpt', event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          {type.fields.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldInputs
                  fields={type.fields}
                  values={values.fields}
                  errors={errors}
                  disabled={!editable || trashed}
                  onChange={(key, value) => {
                    set('fields', { ...values.fields, [key]: value });
                  }}
                />
              </CardContent>
            </Card>
          )}
        </fieldset>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                Status
                {entry ? (
                  <EntryStatusBadge status={entry.status} trashed={trashed} />
                ) : (
                  <EntryStatusBadge status="draft" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {entry?.publishedAt &&
                (entry.status === 'published' || entry.status === 'scheduled') && (
                  <p className="text-muted-foreground">
                    {entry.status === 'published' ? 'Published' : 'Will publish'}{' '}
                    {formatDateTime(entry.publishedAt)}
                  </p>
                )}
              {entry && (
                <p className="text-muted-foreground">
                  Last saved {formatDateTime(entry.updatedAt)}
                  {entry.lastEditor ? ` by ${entry.lastEditor.displayName}` : ''}
                </p>
              )}
              {dirty && <p className="font-medium text-warning-foreground">Unsaved changes</p>}
              {editable && !trashed && (
                <div className="flex flex-col gap-2">
                  {canPublish && scheduling && (
                    <Field label="Publish on" error={errors.publishedAt}>
                      {(control) => (
                        <Input
                          {...control}
                          type="datetime-local"
                          value={publishAt}
                          onChange={(event) => {
                            setPublishAt(event.target.value);
                          }}
                        />
                      )}
                    </Field>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={canPublish && entry?.status !== 'published' ? 'outline' : 'primary'}
                      disabled={saving || (entry !== null && !dirty)}
                      onClick={() => {
                        save('save');
                      }}
                    >
                      {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                      {!entry || entry.status === 'draft'
                        ? 'Save draft'
                        : entry.status === 'published'
                          ? 'Update'
                          : 'Save'}
                    </Button>
                    {canPublish && entry?.status !== 'published' && !scheduling && (
                      <Button
                        disabled={saving}
                        onClick={() => {
                          save('publish');
                        }}
                      >
                        Publish
                      </Button>
                    )}
                    {canPublish && scheduling && (
                      <Button
                        disabled={saving}
                        onClick={() => {
                          save('schedule');
                        }}
                      >
                        {entry?.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
                      </Button>
                    )}
                    {!canPublish && entry?.status !== 'pending' && (
                      <Button
                        disabled={saving}
                        onClick={() => {
                          save('submit');
                        }}
                      >
                        Submit for review
                      </Button>
                    )}
                    {entry &&
                      (entry.status === 'published' ||
                        entry.status === 'scheduled' ||
                        (entry.status === 'pending' && !canPublish)) && (
                        <Button
                          variant="outline"
                          disabled={saving}
                          onClick={() => {
                            save('unpublish');
                          }}
                        >
                          {entry.status === 'published'
                            ? 'Unpublish'
                            : entry.status === 'scheduled'
                              ? 'Unschedule'
                              : 'Withdraw'}
                        </Button>
                      )}
                  </div>
                  {canPublish && entry?.status !== 'published' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto self-start px-1 py-0.5 text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setScheduling((current) => !current);
                      }}
                    >
                      {scheduling ? 'Publish now instead' : 'Schedule for later'}
                    </Button>
                  )}
                </div>
              )}
              {entry && !trashed && (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {entry.status === 'published' && entry.url !== null && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={entry.url} target="_blank" rel="noopener">
                        <ExternalLink aria-hidden="true" /> View
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={previewLink.isPending}
                    onClick={() => {
                      // Open the tab synchronously (popup blockers) and point it at the link once issued.
                      const tab = window.open('about:blank', '_blank');
                      if (tab) tab.opener = null;
                      previewLink.mutate(entry.id, {
                        onSuccess: (link) => {
                          if (tab) tab.location.href = link.url;
                          else window.location.assign(link.url);
                          if (dirty) toast.info('The preview shows the last saved version.');
                        },
                        onError: (error) => {
                          tab?.close();
                          toast.error(errorMessage(error));
                        },
                      });
                    }}
                  >
                    <Eye aria-hidden="true" /> Preview
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {entry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRevisionsOpen(true);
                    }}
                  >
                    <History aria-hidden="true" /> Revisions
                  </Button>
                )}
                {entry && permissions?.trash && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => {
                      entryAction.mutate(
                        { id: entry.id, action: 'trash' },
                        {
                          onSuccess: () => {
                            toast.success('Moved to the trash.');
                            skipBlock.current = true;
                            void navigate(`/content/${type.key}`);
                          },
                          onError: (error) => toast.error(errorMessage(error)),
                        },
                      );
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Move to trash
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {type.hierarchical && (
            <Card>
              <CardContent className="pt-6">
                <ParentSelect
                  type={type}
                  entry={entry}
                  value={values.parentId}
                  disabled={!editable || trashed}
                  error={errors.parentId}
                  onChange={(parentId) => {
                    set('parentId', parentId);
                  }}
                />
              </CardContent>
            </Card>
          )}

          {taxonomies.map((taxonomy) => {
            const own = values.termIds.filter((id) => termTaxonomy[id] === taxonomy.id);
            return (
              <Card key={taxonomy.id}>
                <CardHeader>
                  <CardTitle className="text-base">{taxonomy.pluralName}</CardTitle>
                </CardHeader>
                <CardContent>
                  {taxonomy.hierarchical ? (
                    <CategoryChecklist
                      taxonomy={taxonomy}
                      selected={values.termIds}
                      disabled={!editable || trashed}
                      onChange={(termIds) => {
                        const added = termIds.filter((id) => !values.termIds.includes(id));
                        setTermTaxonomy((current) => ({
                          ...current,
                          ...Object.fromEntries(added.map((id) => [id, taxonomy.id])),
                        }));
                        set('termIds', [...termIds].sort());
                      }}
                    />
                  ) : (
                    <TagInput
                      taxonomy={taxonomy}
                      selected={own}
                      names={termNames}
                      disabled={!editable || trashed}
                      onChange={(ids, names) => {
                        setTermNames(names);
                        setTermTaxonomy((current) => ({
                          ...current,
                          ...Object.fromEntries(ids.map((id) => [id, taxonomy.id])),
                        }));
                        const others = values.termIds.filter((id) => !own.includes(id));
                        set('termIds', [...new Set([...others, ...ids])].sort());
                      }}
                    />
                  )}
                  {errors.termIds && (
                    <p className="mt-2 text-xs font-medium text-danger">{errors.termIds}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {type.hasFeaturedImage && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Featured image</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {featured && values.featuredMediaId ? (
                  <img
                    src={featured.url}
                    alt={featured.alt}
                    className="w-full rounded-md border object-cover"
                  />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ImageIcon className="size-4" aria-hidden="true" /> No image selected
                  </p>
                )}
                {editable && !trashed && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPickingFeatured(true);
                      }}
                    >
                      {values.featuredMediaId ? 'Replace image' : 'Choose image'}
                    </Button>
                    {values.featuredMediaId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          set('featuredMediaId', null);
                        }}
                      >
                        <X aria-hidden="true" /> Remove
                      </Button>
                    )}
                  </div>
                )}
                {errors.featuredMediaId && (
                  <p className="text-xs font-medium text-danger">{errors.featuredMediaId}</p>
                )}
              </CardContent>
            </Card>
          )}

          <SeoPanel
            seo={values.seo}
            title={values.title}
            excerpt={values.excerpt}
            url={entry?.url ?? null}
            disabled={!editable || trashed}
            errors={errors}
            onChange={(seo) => {
              set('seo', seo);
            }}
          />
        </div>
      </div>

      <MediaPickerDialog
        open={pickingFeatured}
        onOpenChange={setPickingFeatured}
        kind="image"
        title="Choose a featured image"
        onSelect={(item) => {
          setFeatured({ url: item.thumbnailUrl ?? item.url, alt: item.altText });
          set('featuredMediaId', item.id);
        }}
      />
      <MediaPickerDialog
        open={pickingInline}
        onOpenChange={(open) => {
          setPickingInline(open);
          if (!open) {
            imagePicker.current?.(null);
            imagePicker.current = null;
          }
        }}
        kind="image"
        title="Insert an image"
        onSelect={(item) => {
          imagePicker.current?.({
            id: item.id,
            url: item.variants.at(-1)?.url ?? item.url,
            altText: item.altText,
          });
          imagePicker.current = null;
        }}
      />
      {entry && (
        <RevisionsDialog
          entry={entry}
          open={revisionsOpen}
          onOpenChange={setRevisionsOpen}
          canRestore={editable && !trashed}
          dirty={dirty}
          onRestored={(restored) => {
            adopt(restored);
            setEditorKey((key) => key + 1);
          }}
        />
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title="Leave without saving?"
        description="Your changes to this entry have not been saved."
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}

export function EntryEditorPage() {
  const { type: typeKey, id } = useParams();
  const isNew = id === 'new';
  const model = useContentModel();
  const entry = useEntry(isNew || !id ? null : id);
  if (model.isPending || (!isNew && entry.isPending)) {
    return <Skeleton className="h-96" role="status" aria-label="Loading" />;
  }
  if (model.isError || entry.isError) {
    if (entry.error instanceof ApiError && entry.error.status === 404) return <NotFoundPage />;
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(model.error ?? entry.error)}</AlertDescription>
      </Alert>
    );
  }
  const type = model.data.contentTypes.find((candidate) => candidate.key === typeKey);
  if (!type || (!isNew && entry.data?.contentTypeId !== type.id)) return <NotFoundPage />;
  const taxonomies = model.data.taxonomies.filter((taxonomy) =>
    type.taxonomyIds.includes(taxonomy.id),
  );
  return (
    <EntryEditor
      key={isNew ? `new-${type.key}` : (entry.data?.id ?? '')}
      type={type}
      taxonomies={taxonomies}
      initial={isNew ? null : (entry.data ?? null)}
    />
  );
}
