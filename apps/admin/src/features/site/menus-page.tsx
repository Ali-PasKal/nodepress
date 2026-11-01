import {
  MENU_MAX_DEPTH,
  saveMenuSchema,
  type MenuDetail,
  type MenuItemInfo,
  type MenuItemKind,
  type MenusResponse,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  cn,
} from '@nexora/ui';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useDeferredValue, useState, type SyntheticEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { useContentModel, useEntries, useTerms } from '../content/api';
import { useCreateMenu, useDeleteMenu, useMenu, useMenus, useSaveMenu } from './api';

/** An item while editing: a flat list in display order, nesting expressed by depth. */
interface DraftItem {
  key: string;
  depth: number;
  label: string;
  kind: MenuItemKind;
  entryId: string | null;
  termId: string | null;
  url: string | null;
  openInNewTab: boolean;
  targetTitle: string;
  state: MenuItemInfo['target']['state'];
}

let keyCounter = 0;
const nextKey = () => {
  keyCounter += 1;
  return `new-${String(keyCounter)}`;
};

/** Depth never exceeds the previous item's depth + 1 (and the maximum), so the list stays a valid tree. */
function normalize(items: DraftItem[]): DraftItem[] {
  let previous = -1;
  return items.map((item) => {
    const depth = Math.max(0, Math.min(item.depth, previous + 1, MENU_MAX_DEPTH - 1));
    previous = depth;
    return depth === item.depth ? item : { ...item, depth };
  });
}

function toDrafts(menu: MenuDetail): DraftItem[] {
  const depth = new Map<string, number>();
  return menu.items.map((item) => {
    const level = item.parentId === null ? 0 : (depth.get(item.parentId) ?? 0) + 1;
    depth.set(item.id, level);
    return {
      key: item.id,
      depth: level,
      label: item.label,
      kind: item.kind,
      entryId: item.entryId,
      termId: item.termId,
      url: item.url,
      openInNewTab: item.openInNewTab,
      targetTitle: item.target.title,
      state: item.target.state,
    };
  });
}

function toPayload(items: readonly DraftItem[]) {
  const stack: string[] = [];
  return items.map((item) => {
    stack.length = item.depth;
    const parentKey = item.depth > 0 ? (stack[item.depth - 1] ?? null) : null;
    stack[item.depth] = item.key;
    return {
      key: item.key,
      parentKey,
      label: item.label.trim(),
      kind: item.kind,
      entryId: item.entryId,
      termId: item.termId,
      url: item.url,
      openInNewTab: item.openInNewTab,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Adding items
// ---------------------------------------------------------------------------------------------

function AddEntry({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const model = useContentModel();
  const types = (model.data?.contentTypes ?? []).filter((type) => type.isPublic);
  const [typeKey, setTypeKey] = useState('page');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const type = types.find((candidate) => candidate.key === typeKey) ?? types[0];
  const entries = useEntries({
    type: type?.key ?? 'page',
    status: 'all',
    search: deferred,
    termId: '',
    page: 1,
    sort: 'title',
    pageSize: 20,
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <NativeSelect
          aria-label="Content type"
          className="w-36"
          value={type?.key ?? ''}
          onChange={(event) => {
            setTypeKey(event.target.value);
          }}
        >
          {types.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.pluralName}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="Search entries"
          placeholder="Search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>
      <ul className="max-h-56 overflow-y-auto rounded-md border" aria-label="Entries">
        {(entries.data?.items ?? []).map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <span className="min-w-0 truncate text-sm">
              {entry.title || '(untitled)'}
              {entry.status !== 'published' && (
                <Badge tone="warning" className="ms-2">
                  {entry.status}
                </Badge>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Add ${entry.title || 'entry'} to the menu`}
              onClick={() => {
                onAdd({
                  key: nextKey(),
                  depth: 0,
                  label: '',
                  kind: 'entry',
                  entryId: entry.id,
                  termId: null,
                  url: null,
                  openInNewTab: false,
                  targetTitle: entry.title,
                  state: entry.status === 'published' ? 'available' : 'unpublished',
                });
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </li>
        ))}
        {entries.data?.items.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">Nothing found.</li>
        )}
      </ul>
    </div>
  );
}

function AddTerm({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const model = useContentModel();
  const taxonomies = (model.data?.taxonomies ?? []).filter((taxonomy) => taxonomy.isPublic);
  const [taxonomyId, setTaxonomyId] = useState<string | null>(null);
  const selected =
    taxonomies.find((taxonomy) => taxonomy.id === taxonomyId) ?? taxonomies[0] ?? null;
  const terms = useTerms(selected?.id ?? null, '', 200);
  return (
    <div className="flex flex-col gap-2">
      <NativeSelect
        aria-label="Taxonomy"
        value={selected?.id ?? ''}
        onChange={(event) => {
          setTaxonomyId(event.target.value);
        }}
      >
        {taxonomies.map((taxonomy) => (
          <option key={taxonomy.id} value={taxonomy.id}>
            {taxonomy.pluralName}
          </option>
        ))}
      </NativeSelect>
      <ul className="max-h-56 overflow-y-auto rounded-md border" aria-label="Terms">
        {(terms.data?.items ?? []).map((term) => (
          <li
            key={term.id}
            className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <span className="min-w-0 truncate text-sm">{term.name}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Add ${term.name} to the menu`}
              onClick={() => {
                onAdd({
                  key: nextKey(),
                  depth: 0,
                  label: '',
                  kind: 'term',
                  entryId: null,
                  termId: term.id,
                  url: null,
                  openInNewTab: false,
                  targetTitle: term.name,
                  state: 'available',
                });
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </li>
        ))}
        {terms.data?.items.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No terms yet.</li>
        )}
      </ul>
    </div>
  );
}

function AddLink({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const ready = label.trim() !== '' && url.trim() !== '';
  // Not a <form>: this panel sits inside the menu editor's form, and forms cannot be nested.
  return (
    <div className="flex flex-col gap-2">
      <Field label="Link text">
        {(control) => (
          <Input
            {...control}
            value={label}
            maxLength={200}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="URL" description='A site path ("/contact") or an http(s), mailto or tel link.'>
        {(control) => (
          <Input
            {...control}
            value={url}
            maxLength={2048}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        )}
      </Field>
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            onAdd({
              key: nextKey(),
              depth: 0,
              label: label.trim(),
              kind: 'url',
              entryId: null,
              termId: null,
              url: url.trim(),
              openInNewTab: false,
              targetTitle: url.trim(),
              state: 'available',
            });
            setLabel('');
            setUrl('');
          }}
        >
          <Plus aria-hidden="true" />
          Add link
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

function MenuEditor({
  menu,
  locations,
}: {
  menu: MenuDetail;
  locations: MenusResponse['locations'];
}) {
  const [name, setName] = useState(menu.name);
  const [location, setLocation] = useState<string | null>(menu.location);
  const [items, setItems] = useState<DraftItem[]>(() => toDrafts(menu));
  const [adding, setAdding] = useState<'entry' | 'term' | 'link'>('entry');
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveMenu(menu.id);
  const remove = useDeleteMenu();

  const update = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) =>
      normalize(current.map((item, i) => (i === index ? { ...item, ...patch } : item))),
    );
  };
  const move = (index: number, offset: -1 | 1) => {
    setItems((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return normalize(next);
    });
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const payload = { name: name.trim(), location, items: toPayload(items) };
    const parsed = saveMenuSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setErrors([]);
    save.mutate(payload, {
      onSuccess: (saved) => {
        setItems(toDrafts(saved));
        toast.success('Menu saved.');
      },
      onError: (error) => {
        setErrors(
          error instanceof ApiError && error.issues.length > 0
            ? error.issues.map((issue) => issue.message)
            : [],
        );
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Menu settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Menu name">
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Show in" description="Locations offered by the active theme.">
            {(control) => (
              <NativeSelect
                {...control}
                value={location ?? ''}
                onChange={(event) => {
                  setLocation(event.target.value === '' ? null : event.target.value);
                }}
              >
                <option value="">Not shown</option>
                {locations.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                    {candidate.menuId !== null && candidate.menuId !== menu.id
                      ? ' (replaces the current menu)'
                      : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <CardDescription>
              Use the arrows to reorder and nest items (up to {MENU_MAX_DEPTH} levels). Unpublished
              targets are hidden on the site until they are published.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <EmptyState
                title="This menu is empty"
                description="Add pages, posts, categories or links."
              />
            ) : (
              <ol className="flex flex-col gap-2" aria-label="Menu items">
                {items.map((item, index) => (
                  <li
                    key={item.key}
                    className="flex flex-col gap-2 rounded-md border p-3"
                    style={{ marginInlineStart: `${String(item.depth * 1.5)}rem` }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.label ||
                            item.targetTitle ||
                            (item.kind === 'home' ? 'Home' : '(untitled)')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.kind === 'entry'
                            ? 'Entry'
                            : item.kind === 'term'
                              ? 'Term'
                              : item.kind === 'home'
                                ? 'Home page'
                                : item.url}
                          {item.state !== 'available' && (
                            <Badge tone="warning" className="ms-2">
                              {item.state === 'missing' ? 'missing' : 'hidden until published'}
                            </Badge>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-0.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => {
                            move(index, -1);
                          }}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Move down"
                          disabled={index === items.length - 1}
                          onClick={() => {
                            move(index, 1);
                          }}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Move out one level"
                          disabled={item.depth === 0}
                          onClick={() => {
                            update(index, { depth: item.depth - 1 });
                          }}
                        >
                          <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Move in one level"
                          disabled={
                            index === 0 ||
                            item.depth >= MENU_MAX_DEPTH - 1 ||
                            (items[index - 1]?.depth ?? 0) < item.depth
                          }
                          onClick={() => {
                            update(index, { depth: item.depth + 1 });
                          }}
                        >
                          <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Remove item"
                          onClick={() => {
                            setItems((current) => normalize(current.filter((_, i) => i !== index)));
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        aria-label="Label"
                        placeholder={item.targetTitle || 'Label'}
                        value={item.label}
                        maxLength={200}
                        onChange={(event) => {
                          update(index, { label: event.target.value });
                        }}
                      />
                      {item.kind === 'url' && (
                        <Input
                          aria-label="URL"
                          value={item.url ?? ''}
                          maxLength={2048}
                          onChange={(event) => {
                            update(index, { url: event.target.value });
                          }}
                        />
                      )}
                    </div>
                    <Label className="flex items-center gap-2 text-xs font-normal">
                      <Checkbox
                        checked={item.openInNewTab}
                        onChange={(event) => {
                          update(index, { openInNewTab: event.target.checked });
                        }}
                      />
                      Open in a new tab
                    </Label>
                  </li>
                ))}
              </ol>
            )}
            {errors.length > 0 && (
              <Alert tone="danger" className="mt-4">
                <CircleX aria-hidden="true" />
                <AlertDescription>
                  <ul>
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add items</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
              role="tablist"
              aria-label="Item type"
            >
              {(
                [
                  ['entry', 'Content'],
                  ['term', 'Terms'],
                  ['link', 'Link'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={adding === value}
                  className={cn(
                    'rounded px-2 py-1 text-sm font-medium',
                    adding === value ? 'bg-surface shadow-xs' : 'text-muted-foreground',
                  )}
                  onClick={() => {
                    setAdding(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {adding === 'entry' && (
              <AddEntry
                onAdd={(item) => {
                  setItems((current) => [...current, item]);
                }}
              />
            )}
            {adding === 'term' && (
              <AddTerm
                onAdd={(item) => {
                  setItems((current) => [...current, item]);
                }}
              />
            )}
            {adding === 'link' && (
              <AddLink
                onAdd={(item) => {
                  setItems((current) => [...current, item]);
                }}
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setItems((current) => [
                  ...current,
                  {
                    key: nextKey(),
                    depth: 0,
                    label: '',
                    kind: 'home',
                    entryId: null,
                    termId: null,
                    url: null,
                    openInNewTab: false,
                    targetTitle: 'Home',
                    state: 'available',
                  },
                ]);
              }}
            >
              <Plus aria-hidden="true" />
              Add home page link
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save menu
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setConfirmDelete(true);
          }}
        >
          <Trash2 aria-hidden="true" />
          Delete menu
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the menu “${menu.name}”?`}
        description="Its items are deleted too. Pages and terms are not affected."
        confirmLabel="Delete menu"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          remove.mutate(menu.id, {
            onSuccess: () => {
              toast.success('Menu deleted.');
              setConfirmDelete(false);
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </form>
  );
}

export function MenusPage() {
  const menus = useMenus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const create = useCreateMenu();
  const selected =
    menus.data?.menus.find((menu) => menu.id === selectedId)?.id ??
    menus.data?.menus[0]?.id ??
    null;
  const menu = useMenu(selected);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menus"
        description="Navigation menus shown by the theme in its menu locations."
      />
      {menus.isPending ? (
        <Skeleton className="h-64" />
      ) : menus.isError ? (
        <Alert tone="danger">
          <CircleX aria-hidden="true" />
          <AlertDescription>{errorMessage(menus.error)}</AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap items-end gap-3">
                {menus.data.menus.length > 0 && (
                  <Field label="Edit menu" className="min-w-48">
                    {(control) => (
                      <NativeSelect
                        {...control}
                        value={selected ?? ''}
                        onChange={(event) => {
                          setSelectedId(event.target.value);
                        }}
                      >
                        {menus.data.menus.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.location
                              ? ` — ${menus.data.locations.find((location) => location.key === item.location)?.label ?? item.location}`
                              : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (newName.trim() === '') return;
                    create.mutate(
                      { name: newName.trim() },
                      {
                        onSuccess: (created) => {
                          setSelectedId(created.id);
                          setNewName('');
                          toast.success('Menu created.');
                        },
                        onError: (error) => toast.error(errorMessage(error)),
                      },
                    );
                  }}
                >
                  <Field label="New menu">
                    {(control) => (
                      <Input
                        {...control}
                        placeholder="Menu name"
                        value={newName}
                        maxLength={100}
                        onChange={(event) => {
                          setNewName(event.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={create.isPending || newName.trim() === ''}
                  >
                    <Plus aria-hidden="true" />
                    Create
                  </Button>
                </form>
              </div>
              {menus.data.locations.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {menus.data.locations
                    .map((location) => {
                      const assigned = menus.data.menus.find((item) => item.id === location.menuId);
                      return `${location.label}: ${assigned ? assigned.name : 'no menu'}`;
                    })
                    .join(' · ')}
                </p>
              )}
            </CardContent>
          </Card>
          {selected === null ? (
            <EmptyState
              title="No menus yet"
              description="Create a menu, add items and choose where the theme shows it."
            />
          ) : menu.isPending ? (
            <Skeleton className="h-64" />
          ) : menu.isError ? (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(menu.error)}</AlertDescription>
            </Alert>
          ) : (
            <MenuEditor
              key={`${menu.data.id}:${menu.data.updatedAt}`}
              menu={menu.data}
              locations={menus.data.locations}
            />
          )}
        </>
      )}
    </div>
  );
}
