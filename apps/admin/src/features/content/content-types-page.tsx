import {
  defaultRoutePrefix,
  FIELD_TYPES,
  type ContentTypeInfo,
  type FieldDefinition,
  type FieldType,
  type TaxonomyInfo,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@nexora/ui';
import { ArrowDown, ArrowUp, Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import {
  useContentModel,
  useDeleteContentType,
  useDeleteTaxonomy,
  useSaveContentType,
  useSaveTaxonomy,
} from './api';

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  boolean: 'Yes / no',
  date: 'Date',
  select: 'Choice',
  url: 'Link (URL)',
  email: 'Email',
  media: 'Media file',
};

/** Editable field row; type-specific settings are kept as strings until saved. */
interface FieldDraft {
  readonly uid: number;
  key: string;
  keyTouched: boolean;
  label: string;
  type: FieldType;
  required: boolean;
  description: string;
  maxLength: string;
  min: string;
  max: string;
  integer: boolean;
  options: string;
  public: boolean;
}

let uid = 0;
function toKey(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
}

function draftFrom(field: FieldDefinition): FieldDraft {
  uid += 1;
  return {
    uid,
    key: field.key,
    keyTouched: true,
    label: field.label,
    type: field.type,
    required: field.required,
    description: field.description,
    maxLength: 'maxLength' in field ? String(field.maxLength) : '',
    min: field.type === 'number' && field.min !== null ? String(field.min) : '',
    max: field.type === 'number' && field.max !== null ? String(field.max) : '',
    integer: field.type === 'number' ? field.integer : false,
    options:
      field.type === 'select'
        ? field.options.map((option) => `${option.value}: ${option.label}`).join('\n')
        : '',
    public: field.public,
  };
}

function newDraft(): FieldDraft {
  uid += 1;
  return {
    uid,
    key: '',
    keyTouched: false,
    label: '',
    type: 'text',
    required: false,
    description: '',
    maxLength: '',
    min: '',
    max: '',
    integer: false,
    options: '',
    public: false,
  };
}

function toDefinition(draft: FieldDraft): Record<string, unknown> {
  const base = {
    key: draft.key,
    label: draft.label,
    type: draft.type,
    required: draft.required,
    description: draft.description,
    public: draft.public,
  };
  switch (draft.type) {
    case 'text':
    case 'textarea':
      return draft.maxLength ? { ...base, maxLength: Number(draft.maxLength) } : base;
    case 'number':
      return {
        ...base,
        integer: draft.integer,
        min: draft.min === '' ? null : Number(draft.min),
        max: draft.max === '' ? null : Number(draft.max),
      };
    case 'select':
      return {
        ...base,
        options: draft.options
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [value = '', ...rest] = line.split(':');
            const label = rest.join(':').trim();
            return { value: value.trim(), label: label || value.trim() };
          }),
      };
    default:
      return base;
  }
}

function FieldRow({
  draft,
  index,
  count,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  draft: FieldDraft;
  index: number;
  count: number;
  errors: Readonly<Record<string, string>>;
  onChange: (draft: FieldDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const error = (name: string) => errors[`fields.${String(index)}.${name}`];
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3" data-testid="field-row">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
        <Field label="Label" error={error('label')}>
          {(control) => (
            <Input
              {...control}
              value={draft.label}
              onChange={(event) => {
                onChange({
                  ...draft,
                  label: event.target.value,
                  ...(draft.keyTouched ? {} : { key: toKey(event.target.value) }),
                });
              }}
            />
          )}
        </Field>
        <Field label="Key" error={error('key')}>
          {(control) => (
            <Input
              {...control}
              className="font-mono text-sm"
              value={draft.key}
              onChange={(event) => {
                onChange({ ...draft, key: event.target.value, keyTouched: true });
              }}
            />
          )}
        </Field>
        <Field label="Type">
          {(control) => (
            <NativeSelect
              {...control}
              value={draft.type}
              onChange={(event) => {
                onChange({ ...draft, type: event.target.value as FieldType });
              }}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      {(draft.type === 'text' || draft.type === 'textarea') && (
        <Field label="Maximum length" description="Optional." error={error('maxLength')}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              className="sm:w-40"
              value={draft.maxLength}
              onChange={(event) => {
                onChange({ ...draft, maxLength: event.target.value });
              }}
            />
          )}
        </Field>
      )}
      {draft.type === 'number' && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Minimum" error={error('min')}>
            {(control) => (
              <Input
                {...control}
                type="number"
                className="w-32"
                value={draft.min}
                onChange={(event) => {
                  onChange({ ...draft, min: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Maximum" error={error('max')}>
            {(control) => (
              <Input
                {...control}
                type="number"
                className="w-32"
                value={draft.max}
                onChange={(event) => {
                  onChange({ ...draft, max: event.target.value });
                }}
              />
            )}
          </Field>
          <Label className="mb-2 flex items-center gap-2 font-normal">
            <Checkbox
              checked={draft.integer}
              onChange={(event) => {
                onChange({ ...draft, integer: event.target.checked });
              }}
            />
            Whole numbers only
          </Label>
        </div>
      )}
      {draft.type === 'select' && (
        <Field
          label="Choices"
          description="One per line, as “value: Label” (for example “small: Small”)."
          error={error('options')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={draft.options}
              onChange={(event) => {
                onChange({ ...draft, options: event.target.value });
              }}
            />
          )}
        </Field>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={draft.required}
            onChange={(event) => {
              onChange({ ...draft, required: event.target.checked });
            }}
          />
          Required
        </Label>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={draft.public}
            onChange={(event) => {
              onChange({ ...draft, public: event.target.checked });
            }}
          />
          Show on the public site
        </Label>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${draft.label || 'field'} up`}
            disabled={index === 0}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${draft.label || 'field'} down`}
            disabled={index === count - 1}
            onClick={() => {
              onMove(1);
            }}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${draft.label || 'field'}`}
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Public address and visibility of a content type or taxonomy. */
function RouteFields({
  prefix,
  onPrefixChange,
  isPublic,
  onPublicChange,
  root,
  errors,
  noun,
}: {
  prefix: string;
  onPrefixChange: (value: string) => void;
  isPublic: boolean;
  onPublicChange: (value: boolean) => void;
  root: boolean;
  errors: Record<string, string>;
  noun: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Public site</legend>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={isPublic}
          onChange={(event) => {
            onPublicChange(event.target.checked);
          }}
        />
        Public (published {noun} appear on the site and in the Delivery API)
      </Label>
      {errors.isPublic && <p className="text-xs font-medium text-danger">{errors.isPublic}</p>}
      {root ? (
        <p className="text-xs text-muted-foreground">Pages live at the site root (e.g. /about).</p>
      ) : (
        <Field
          label="Address prefix"
          description={`Lower-case words and hyphens. Addresses look like /${prefix || 'prefix'}/… Published ${noun} keep working at their old address after a change (redirects are created).`}
          error={errors.routePrefix}
        >
          {(control) => (
            <Input
              {...control}
              className="font-mono text-sm"
              value={prefix}
              maxLength={64}
              onChange={(event) => {
                onPrefixChange(event.target.value);
              }}
            />
          )}
        </Field>
      )}
    </fieldset>
  );
}

function issuesOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message]));
}

function ContentTypeForm({
  type,
  taxonomies,
  onDone,
}: {
  type: ContentTypeInfo | null;
  taxonomies: readonly TaxonomyInfo[];
  onDone: () => void;
}) {
  const save = useSaveContentType();
  const [name, setName] = useState(type?.name ?? '');
  const [pluralName, setPluralName] = useState(type?.pluralName ?? '');
  const [key, setKey] = useState(type?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(type !== null);
  const [description, setDescription] = useState(type?.description ?? '');
  const [hierarchical, setHierarchical] = useState(type?.hierarchical ?? false);
  const [hasBody, setHasBody] = useState(type?.hasBody ?? true);
  const [hasExcerpt, setHasExcerpt] = useState(type?.hasExcerpt ?? true);
  const [hasFeaturedImage, setHasFeaturedImage] = useState(type?.hasFeaturedImage ?? true);
  const [hasBuilder, setHasBuilder] = useState(type?.hasBuilder ?? false);
  const [taxonomyIds, setTaxonomyIds] = useState<string[]>(type?.taxonomyIds ?? []);
  const [routePrefix, setRoutePrefix] = useState(type?.routePrefix ?? '');
  const [prefixTouched, setPrefixTouched] = useState(type !== null);
  const [isPublic, setIsPublic] = useState(type?.isPublic ?? true);
  const isRoot = type !== null && type.routePrefix === '';
  const [fields, setFields] = useState<FieldDraft[]>(() => (type?.fields ?? []).map(draftFrom));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setErrors({});
    setFormError(null);
    const body = {
      name,
      pluralName,
      description,
      hierarchical,
      hasBody,
      hasExcerpt,
      hasFeaturedImage,
      hasBuilder,
      taxonomyIds,
      fields: fields.map(toDefinition) as never,
      isPublic,
      ...(isRoot || routePrefix.trim() === '' ? {} : { routePrefix: routePrefix.trim() }),
    };
    save.mutate(type ? { id: type.id, body } : { body: { ...body, key } }, {
      onSuccess: (saved) => {
        toast.success(type ? `${saved.name} was updated.` : `${saved.name} was created.`);
        onDone();
      },
      onError: (error) => {
        const issues = issuesOf(error);
        setErrors(issues);
        setFormError(
          Object.keys(issues).length > 0
            ? 'Please correct the highlighted fields.'
            : errorMessage(error),
        );
      },
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
    >
      {formError && (
        <Alert tone="danger">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name (singular)" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              autoFocus
              value={name}
              placeholder="Product"
              onChange={(event) => {
                setName(event.target.value);
                if (!keyTouched) {
                  const nextKey = toKey(event.target.value).slice(0, 32);
                  setKey(nextKey);
                  if (!prefixTouched) setRoutePrefix(defaultRoutePrefix(nextKey));
                }
              }}
            />
          )}
        </Field>
        <Field label="Name (plural)" error={errors.pluralName}>
          {(control) => (
            <Input
              {...control}
              value={pluralName}
              placeholder="Products"
              onChange={(event) => {
                setPluralName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Key"
          description={type ? 'Keys cannot be changed.' : 'Used in URLs and the API.'}
          error={errors.key}
        >
          {(control) => (
            <Input
              {...control}
              className="font-mono text-sm"
              disabled={type !== null}
              value={key}
              onChange={(event) => {
                setKeyTouched(true);
                setKey(event.target.value);
                if (!prefixTouched) setRoutePrefix(defaultRoutePrefix(event.target.value));
              }}
            />
          )}
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        )}
      </Field>
      <RouteFields
        prefix={routePrefix}
        onPrefixChange={(value) => {
          setPrefixTouched(true);
          setRoutePrefix(value);
        }}
        isPublic={isPublic}
        onPublicChange={setIsPublic}
        root={isRoot}
        errors={errors}
        noun="entries"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Features</legend>
        {[
          { label: 'Rich-text content', checked: hasBody, set: setHasBody },
          { label: 'Excerpt', checked: hasExcerpt, set: setHasExcerpt },
          { label: 'Featured image', checked: hasFeaturedImage, set: setHasFeaturedImage },
          {
            label: 'Visual builder (sections, columns, widgets)',
            checked: hasBuilder,
            set: setHasBuilder,
          },
        ].map((option) => (
          <Label key={option.label} className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={option.checked}
              onChange={(event) => {
                option.set(event.target.checked);
              }}
            />
            {option.label}
          </Label>
        ))}
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={hierarchical}
            disabled={type !== null && type.entryCount > 0}
            onChange={(event) => {
              setHierarchical(event.target.checked);
            }}
          />
          Hierarchical (entries can have a parent, like pages)
        </Label>
        {errors.hierarchical && (
          <p className="text-xs font-medium text-danger">{errors.hierarchical}</p>
        )}
      </fieldset>
      {taxonomies.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Taxonomies</legend>
          {taxonomies.map((taxonomy) => (
            <Label key={taxonomy.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={taxonomyIds.includes(taxonomy.id)}
                onChange={(event) => {
                  setTaxonomyIds(
                    event.target.checked
                      ? [...taxonomyIds, taxonomy.id]
                      : taxonomyIds.filter((id) => id !== taxonomy.id),
                  );
                }}
              />
              {taxonomy.pluralName}
            </Label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Custom fields</legend>
        {errors.fields && <p className="text-xs font-medium text-danger">{errors.fields}</p>}
        {fields.length === 0 && <p className="text-sm text-muted-foreground">No custom fields.</p>}
        <ol className="flex flex-col gap-3">
          {fields.map((draft, index) => (
            <FieldRow
              key={draft.uid}
              draft={draft}
              index={index}
              count={fields.length}
              errors={errors}
              onChange={(next) => {
                setFields(fields.map((item) => (item.uid === draft.uid ? next : item)));
              }}
              onMove={(delta) => {
                const next = [...fields];
                const target = index + delta;
                const [moved] = next.splice(index, 1);
                if (moved) next.splice(target, 0, moved);
                setFields(next);
              }}
              onRemove={() => {
                setFields(fields.filter((item) => item.uid !== draft.uid));
              }}
            />
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            setFields([...fields, newDraft()]);
          }}
        >
          <Plus aria-hidden="true" /> Add field
        </Button>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {type ? 'Save changes' : 'Create content type'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TaxonomyForm({
  taxonomy,
  types,
  onDone,
}: {
  taxonomy: TaxonomyInfo | null;
  types: readonly ContentTypeInfo[];
  onDone: () => void;
}) {
  const save = useSaveTaxonomy();
  const [name, setName] = useState(taxonomy?.name ?? '');
  const [pluralName, setPluralName] = useState(taxonomy?.pluralName ?? '');
  const [key, setKey] = useState(taxonomy?.key ?? '');
  const [hierarchical, setHierarchical] = useState(taxonomy?.hierarchical ?? false);
  const [contentTypeIds, setContentTypeIds] = useState<string[]>(taxonomy?.contentTypeIds ?? []);
  const [routePrefix, setRoutePrefix] = useState(taxonomy?.routePrefix ?? '');
  const [prefixTouched, setPrefixTouched] = useState(taxonomy !== null);
  const [isPublic, setIsPublic] = useState(taxonomy?.isPublic ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = {
          name,
          pluralName,
          contentTypeIds,
          isPublic,
          ...(routePrefix.trim() === '' ? {} : { routePrefix: routePrefix.trim() }),
        };
        save.mutate(
          taxonomy ? { id: taxonomy.id, body } : { body: { ...body, key, hierarchical } },
          {
            onSuccess: (saved) => {
              toast.success(taxonomy ? `${saved.name} was updated.` : `${saved.name} was created.`);
              onDone();
            },
            onError: (error) => {
              const issues = issuesOf(error);
              setErrors(issues);
              setFormError(Object.keys(issues).length > 0 ? null : errorMessage(error));
            },
          },
        );
      }}
    >
      {formError && (
        <Alert tone="danger">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name (singular)" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              autoFocus
              value={name}
              placeholder="Genre"
              onChange={(event) => {
                setName(event.target.value);
                if (!taxonomy) {
                  const nextKey = toKey(event.target.value).slice(0, 32);
                  setKey(nextKey);
                  if (!prefixTouched) setRoutePrefix(defaultRoutePrefix(nextKey));
                }
              }}
            />
          )}
        </Field>
        <Field label="Name (plural)" error={errors.pluralName}>
          {(control) => (
            <Input
              {...control}
              value={pluralName}
              placeholder="Genres"
              onChange={(event) => {
                setPluralName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Key" error={errors.key}>
          {(control) => (
            <Input
              {...control}
              className="font-mono text-sm"
              disabled={taxonomy !== null}
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                if (!prefixTouched) setRoutePrefix(defaultRoutePrefix(event.target.value));
              }}
            />
          )}
        </Field>
      </div>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={hierarchical}
          disabled={taxonomy !== null}
          onChange={(event) => {
            setHierarchical(event.target.checked);
          }}
        />
        Hierarchical (terms can have parents, like categories)
      </Label>
      <RouteFields
        prefix={routePrefix}
        onPrefixChange={(value) => {
          setPrefixTouched(true);
          setRoutePrefix(value);
        }}
        isPublic={isPublic}
        onPublicChange={setIsPublic}
        root={false}
        errors={errors}
        noun="term archives"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Used by</legend>
        {types.map((type) => (
          <Label key={type.id} className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={contentTypeIds.includes(type.id)}
              onChange={(event) => {
                setContentTypeIds(
                  event.target.checked
                    ? [...contentTypeIds, type.id]
                    : contentTypeIds.filter((id) => id !== type.id),
                );
              }}
            />
            {type.pluralName}
          </Label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {taxonomy ? 'Save changes' : 'Create taxonomy'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ContentTypesPage() {
  const model = useContentModel();
  const deleteType = useDeleteContentType();
  const deleteTaxonomy = useDeleteTaxonomy();
  const [editingType, setEditingType] = useState<ContentTypeInfo | 'new' | null>(null);
  const [editingTaxonomy, setEditingTaxonomy] = useState<TaxonomyInfo | 'new' | null>(null);
  const [deleting, setDeleting] = useState<
    { kind: 'type'; item: ContentTypeInfo } | { kind: 'taxonomy'; item: TaxonomyInfo } | null
  >(null);

  if (model.isPending) return <Skeleton className="h-64" role="status" aria-label="Loading" />;
  if (model.isError) {
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(model.error)}</AlertDescription>
      </Alert>
    );
  }
  const { contentTypes, taxonomies } = model.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Content types"
        description="Define what kinds of content this site has, their custom fields, and how they are organised."
        actions={
          <Button
            onClick={() => {
              setEditingType('new');
            }}
          >
            <Plus aria-hidden="true" /> New content type
          </Button>
        }
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {contentTypes.map((type) => (
          <li key={type.id}>
            <Card
              className="flex h-full flex-col gap-3 p-5"
              data-testid={`content-type-${type.key}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                    {type.pluralName}
                    {type.isSystem && <Badge>Built-in</Badge>}
                    {type.hierarchical && <Badge tone="info">Hierarchical</Badge>}
                  </h2>
                  <code className="text-xs text-muted-foreground">
                    {type.key} · {type.isPublic ? `/${type.routePrefix}` : 'not public'}
                  </code>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${type.name}`}
                    onClick={() => {
                      setEditingType(type);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  {type.isSystem ? (
                    <span
                      className="p-2 text-muted-foreground"
                      title="Built-in types cannot be deleted"
                    >
                      <Lock className="size-4" aria-label="Built-in" />
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${type.name}`}
                      onClick={() => {
                        setDeleting({ kind: 'type', item: type });
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              {type.description && (
                <p className="text-sm text-muted-foreground">{type.description}</p>
              )}
              <p className="mt-auto text-xs text-muted-foreground">
                {type.entryCount} {type.entryCount === 1 ? 'entry' : 'entries'} ·{' '}
                {type.fields.length} {type.fields.length === 1 ? 'custom field' : 'custom fields'}
                {type.taxonomyIds.length > 0 &&
                  ` · ${taxonomies
                    .filter((taxonomy) => type.taxonomyIds.includes(taxonomy.id))
                    .map((taxonomy) => taxonomy.pluralName)
                    .join(', ')}`}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-4" aria-labelledby="taxonomies-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="taxonomies-heading" className="text-lg font-semibold">
              Taxonomies
            </h2>
            <p className="text-sm text-muted-foreground">
              Ways to group content, such as categories and tags.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setEditingTaxonomy('new');
            }}
          >
            <Plus aria-hidden="true" /> New taxonomy
          </Button>
        </div>
        <ul className="grid gap-4 md:grid-cols-2">
          {taxonomies.map((taxonomy) => (
            <li key={taxonomy.id}>
              <Card className="flex items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                    {taxonomy.pluralName}
                    {taxonomy.isSystem && <Badge>Built-in</Badge>}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {taxonomy.isPublic ? `/${taxonomy.routePrefix}/… · ` : 'not public · '}
                    {taxonomy.termCount} {taxonomy.termCount === 1 ? 'term' : 'terms'} · used by{' '}
                    {contentTypes
                      .filter((type) => taxonomy.contentTypeIds.includes(type.id))
                      .map((type) => type.pluralName)
                      .join(', ') || 'no content type'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${taxonomy.name}`}
                    onClick={() => {
                      setEditingTaxonomy(taxonomy);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  {!taxonomy.isSystem && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${taxonomy.name}`}
                      onClick={() => {
                        setDeleting({ kind: 'taxonomy', item: taxonomy });
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={editingType !== null}
        onOpenChange={(open) => {
          if (!open) setEditingType(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingType === 'new' ? 'New content type' : `Edit ${editingType?.name ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              Removing a field hides its values; they are dropped when an entry is next saved.
            </DialogDescription>
          </DialogHeader>
          {editingType !== null && (
            <ContentTypeForm
              type={editingType === 'new' ? null : editingType}
              taxonomies={taxonomies}
              onDone={() => {
                setEditingType(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={editingTaxonomy !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTaxonomy(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTaxonomy === 'new' ? 'New taxonomy' : `Edit ${editingTaxonomy?.name ?? ''}`}
            </DialogTitle>
            <DialogDescription>Choose which content types can use it.</DialogDescription>
          </DialogHeader>
          {editingTaxonomy !== null && (
            <TaxonomyForm
              taxonomy={editingTaxonomy === 'new' ? null : editingTaxonomy}
              types={contentTypes}
              onDone={() => {
                setEditingTaxonomy(null);
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
        title={`Delete ${deleting?.item.name ?? ''}?`}
        description={
          deleting?.kind === 'taxonomy'
            ? 'Its terms are deleted and removed from every entry. This cannot be undone.'
            : 'Only content types without entries can be deleted.'
        }
        confirmLabel="Delete"
        destructive
        pending={deleteType.isPending || deleteTaxonomy.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const done = {
            onSuccess: () => toast.success(`${deleting.item.name} was deleted.`),
            onError: (error: unknown) => toast.error(errorMessage(error)),
            onSettled: () => {
              setDeleting(null);
            },
          };
          if (deleting.kind === 'type') deleteType.mutate(deleting.item.id, done);
          else deleteTaxonomy.mutate(deleting.item.id, done);
        }}
      />
    </div>
  );
}
