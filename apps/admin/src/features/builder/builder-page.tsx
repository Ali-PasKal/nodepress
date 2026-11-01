import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import '@nexora/theme-sdk/builder.css';
import './builder-canvas.css';
import {
  builderDocumentSchema,
  builderFromRichText,
  builderMediaIds,
  createWidget,
  mediaDetailSchema,
  WIDGET_TYPES,
  type Breakpoint,
  type BuilderDocument,
  type BuilderWidget,
  type DeliveryMedia,
  type EntryDetail,
  type MediaItem,
} from '@nexora/shared';
import type { BuilderRenderContext } from '@nexora/theme-sdk';
import { Alert, AlertDescription, Button, Input, Skeleton, cn } from '@nexora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Loader2, Monitor, Redo2, Smartphone, Tablet, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageTitle } from '../../components/use-page-title';
import { apiGet, ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { NotFoundPage } from '../../routes/not-found-page';
import { useCapabilities } from '../auth/session';
import {
  contentKeys,
  useContentModel,
  useEntry,
  usePreviewLink,
  useUpdateEntry,
} from '../content/api';
import { Canvas } from './canvas';
import { widgetLabel, type DragData } from './labels';
import { findElement, insertSection, insertWidget, moveSection, moveWidget } from './document-ops';
import { PropertiesPanel } from './properties';
import { useBuilderStore, useIsDirty } from './store';

function toDeliveryMedia(item: MediaItem): DeliveryMedia {
  return {
    id: item.id,
    url: item.url,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    altText: item.altText,
    caption: item.caption,
    sources: [...item.variants].sort((a, b) => a.width - b.width),
  };
}

function LibraryItem({ type, onAdd }: { type: BuilderWidget['widget']; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new:${type}`,
    data: { kind: 'new', widget: type } satisfies DragData,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        'rounded-md border bg-surface px-2 py-3 text-sm font-medium hover:bg-muted',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
      onClick={onAdd}
      aria-label={`Add ${widgetLabel(type)}`}
    >
      {widgetLabel(type)}
    </button>
  );
}

function Navigator() {
  const document = useBuilderStore((state) => state.document);
  const selectedId = useBuilderStore((state) => state.selectedId);
  const select = useBuilderStore((state) => state.select);
  const item = (id: string, label: string, depth: number) => (
    <li key={id}>
      <button
        type="button"
        className={cn(
          'w-full truncate rounded px-2 py-1 text-start text-sm hover:bg-muted',
          selectedId === id && 'bg-sidebar-active text-sidebar-active-foreground',
        )}
        style={{ paddingInlineStart: `${String(0.5 + depth)}rem` }}
        aria-current={selectedId === id ? 'true' : undefined}
        onClick={() => {
          select(id);
        }}
      >
        {label}
      </button>
    </li>
  );
  return (
    <nav aria-label="Navigator">
      <ul className="flex flex-col">
        {document.sections.flatMap((section, s) => [
          item(section.id, `Section ${String(s + 1)}`, 0),
          ...section.children.flatMap((column, c) => [
            item(column.id, `Column ${String(c + 1)} (${String(column.width.desktop)}%)`, 1),
            ...column.children.map((widget) => item(widget.id, widgetLabel(widget.widget), 2)),
          ]),
        ])}
      </ul>
      {document.sections.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">No sections yet.</p>
      ) : null}
    </nav>
  );
}

/** Where a new widget goes when clicked in the library: after the selection, else the last column. */
function addTarget(
  document: BuilderDocument,
  selectedId: string | null,
): { columnId: string; index: number } | null {
  const at = selectedId ? findElement(document, selectedId) : null;
  const end = Number.MAX_SAFE_INTEGER;
  if (at?.kind === 'column') return { columnId: at.node.id, index: end };
  if (at?.kind === 'widget') {
    const column = document.sections[at.section]?.children[at.column];
    return column ? { columnId: column.id, index: at.widget + 1 } : null;
  }
  if (at?.kind === 'section') {
    const column = document.sections[at.section]?.children[0];
    return column ? { columnId: column.id, index: end } : null;
  }
  const lastColumn = document.sections.at(-1)?.children.at(-1);
  return lastColumn ? { columnId: lastColumn.id, index: end } : null;
}

/** Whether a dragged widget sits before the target in the same column (it then lands after the target). */
function before(
  active: ReturnType<typeof findElement>,
  over: ReturnType<typeof findElement>,
): boolean {
  if (!active || !over) return false;
  return (
    active.section === over.section && active.column === over.column && active.widget < over.widget
  );
}

const DEVICES: { device: Breakpoint; label: string; icon: typeof Monitor }[] = [
  { device: 'desktop', label: 'Desktop', icon: Monitor },
  { device: 'tablet', label: 'Tablet', icon: Tablet },
  { device: 'mobile', label: 'Mobile', icon: Smartphone },
];

function Editor({ entry: initial, typeName }: { entry: EntryDetail; typeName: string }) {
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const update = useUpdateEntry();
  const previewLink = usePreviewLink();
  const [entry, setEntry] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [conflict, setConflict] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [media, setMedia] = useState<Record<string, DeliveryMedia>>({});
  const [panel, setPanel] = useState<'widgets' | 'navigator'>('widgets');
  const [dragging, setDragging] = useState<string | null>(null);
  const store = useBuilderStore();
  const dirty = useIsDirty() || title !== entry.title;
  const skipBlock = useRef(false);
  usePageTitle(`Builder: ${title || typeName}`);

  // Load the document once (an entry that still uses rich text starts from its body).
  useEffect(() => {
    const document =
      initial.editor === 'builder' && initial.builder
        ? initial.builder
        : builderDocumentSchema.parse(builderFromRichText(initial.body));
    useBuilderStore.getState().load(document);
    const ids = builderMediaIds(document);
    void Promise.all(
      ids.map((id) => apiGet(`/media/${id}`, mediaDetailSchema).then(toDeliveryMedia, () => null)),
    ).then((items) => {
      setMedia(
        Object.fromEntries(items.filter((item) => item !== null).map((item) => [item.id, item])),
      );
    });
  }, [initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]') !== null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        if (event.shiftKey) useBuilderStore.getState().redo();
        else useBuilderStore.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const context: BuilderRenderContext = useMemo(
    () => ({
      media,
      posts: {},
      shortcodes: {
        resolved: {},
        siteName: 'Site',
        language: 'en',
        editing: true,
      },
      embedUrl: null,
    }),
    [media],
  );

  const addWidget = (type: BuilderWidget['widget']) => {
    const widget = createWidget(type);
    store.apply((document) => {
      let next = document;
      let target = addTarget(next, useBuilderStore.getState().selectedId);
      if (!target) {
        const created = insertSection(next, next.sections.length, [100]);
        next = created.document;
        target = addTarget(next, null);
      }
      return target ? insertWidget(next, target.columnId, target.index, widget) : next;
    }, widget.id);
  };

  const onDragStart = (event: DragStartEvent) => {
    setDragging(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const source = active.data.current as DragData | undefined;
    const target = over.data.current as DragData | undefined;
    const document = useBuilderStore.getState().document;
    if (!source) return;
    if (source.kind === 'section') {
      const from = document.sections.findIndex((section) => section.id === active.id);
      const overAt = findElement(document, String(over.id).replace(/^col:/, ''));
      const to = overAt ? overAt.section : -1;
      if (from >= 0 && to >= 0) store.apply((current) => moveSection(current, from, to));
      return;
    }
    // Widgets (existing or new from the library) land in a column at a position.
    let columnId: string | null = null;
    let index = Number.MAX_SAFE_INTEGER;
    if (target?.kind === 'widget') {
      columnId = target.columnId;
      const overAt = findElement(document, String(over.id));
      index = overAt?.widget ?? index;
      const activeAt = source.kind === 'widget' ? findElement(document, String(active.id)) : null;
      if (before(activeAt, overAt)) index += 1;
    } else if (target?.kind === 'column') {
      columnId = target.columnId;
    } else if (target?.kind === 'section') {
      const at = findElement(document, String(over.id));
      columnId =
        at?.kind === 'section' ? (document.sections[at.section]?.children[0]?.id ?? null) : null;
    }
    if (!columnId) return;
    const column = columnId;
    if (source.kind === 'new') {
      const widget = createWidget(source.widget);
      store.apply((current) => insertWidget(current, column, index, widget), widget.id);
    } else if (source.kind === 'widget') {
      store.apply((current) => moveWidget(current, String(active.id), column, index));
    }
  };

  const save = (publish: boolean) => {
    const parsed = builderDocumentSchema.safeParse(store.document);
    if (!parsed.success) {
      setProblems(
        parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
      toast.error('The layout has problems; fix them before saving.');
      return;
    }
    setProblems([]);
    update.mutate(
      {
        id: entry.id,
        input: {
          version: entry.version,
          editor: 'builder',
          builder: parsed.data,
          ...(title !== entry.title ? { title } : {}),
          ...(publish ? { status: 'published' as const } : {}),
        },
      },
      {
        onSuccess: (saved) => {
          setEntry(saved);
          setTitle(saved.title);
          store.markSaved(store.document);
          queryClient.setQueryData(contentKeys.entry(saved.id), saved);
          toast.success(publish ? `${typeName} published.` : `${typeName} saved.`);
        },
        onError: (error) => {
          if (
            error instanceof ApiError &&
            error.status === 409 &&
            error.message.includes('changed by someone else')
          ) {
            setConflict(true);
            return;
          }
          if (error instanceof ApiError && error.issues.length > 0) {
            setProblems(error.issues.map((issue) => `${issue.path}: ${issue.message}`));
          }
          toast.error(errorMessage(error));
        },
      },
    );
  };

  const canPublish = entry.permissions.publish && entry.status !== 'published';
  const canEmbedHtml = capabilities.has('content.embed_html');

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <BackLink entry={entry} />
        <Input
          aria-label="Title"
          className="h-8 w-48 sm:w-64"
          value={title}
          maxLength={300}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <div
          className="flex items-center rounded-md border p-0.5"
          role="group"
          aria-label="Device preview"
        >
          {DEVICES.map(({ device, label, icon: Icon }) => (
            <Button
              key={device}
              type="button"
              size="icon"
              variant={store.device === device ? 'secondary' : 'ghost'}
              aria-label={label}
              aria-pressed={store.device === device}
              className="size-7"
              onClick={() => {
                store.setDevice(device);
              }}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Undo"
          disabled={store.past.length === 0}
          onClick={store.undo}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Redo"
          disabled={store.future.length === 0}
          onClick={store.redo}
        >
          <Redo2 aria-hidden="true" />
        </Button>
        <div className="ms-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-xs font-medium text-warning-foreground">Unsaved changes</span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={previewLink.isPending}
            onClick={() => {
              const tab = window.open('about:blank', '_blank');
              if (tab) tab.opener = null;
              previewLink.mutate(entry.id, {
                onSuccess: (link) => {
                  if (tab) tab.location.href = link.url;
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
          <Button
            type="button"
            size="sm"
            variant={canPublish ? 'outline' : 'primary'}
            disabled={update.isPending || !entry.permissions.edit}
            onClick={() => {
              save(false);
            }}
          >
            {update.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {entry.status === 'published' ? 'Update' : 'Save draft'}
          </Button>
          {canPublish ? (
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                save(true);
              }}
            >
              Publish
            </Button>
          ) : null}
        </div>
      </header>
      {conflict ? (
        <Alert tone="warning" className="m-3">
          <AlertDescription>
            Someone else changed this {typeName.toLowerCase()} since you opened it. Your changes
            were not saved; reload the page to load the latest version.
          </AlertDescription>
        </Alert>
      ) : null}
      {problems.length > 0 ? (
        <Alert tone="danger" className="m-3">
          <AlertDescription>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside
            className="flex max-h-56 shrink-0 flex-col border-b lg:max-h-none lg:w-60 lg:border-b-0 lg:border-e"
            aria-label="Library"
          >
            <div className="flex border-b" role="tablist" aria-label="Panels">
              {(['widgets', 'navigator'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={panel === value}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-medium capitalize',
                    panel === value ? 'border-b-2 border-primary' : 'text-muted-foreground',
                  )}
                  onClick={() => {
                    setPanel(value);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === 'widgets' ? (
                <div className="grid grid-cols-2 gap-2">
                  {WIDGET_TYPES.filter((type) => type !== 'html' || canEmbedHtml).map((type) => (
                    <LibraryItem
                      key={type}
                      type={type}
                      onAdd={() => {
                        addWidget(type);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Navigator />
              )}
            </div>
          </aside>
          <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40" aria-label="Canvas">
            <Canvas context={context} />
          </main>
          <aside
            className="max-h-[45vh] shrink-0 overflow-y-auto border-t lg:max-h-none lg:w-80 lg:border-s lg:border-t-0"
            aria-label="Properties"
          >
            <PropertiesPanel
              canEmbedHtml={canEmbedHtml}
              onMedia={(item) => {
                setMedia((current) => ({ ...current, [item.id]: toDeliveryMedia(item) }));
              }}
            />
          </aside>
        </div>
        <DragOverlay>
          {dragging?.startsWith('new:') ? (
            <div className="rounded-md border bg-surface px-3 py-2 text-sm font-medium shadow-lg">
              {widgetLabel(dragging.slice(4) as BuilderWidget['widget'])}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {blocker.state === 'blocked' ? (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-2 border-t bg-background p-3"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <span className="text-sm">You have unsaved changes. Leave anyway?</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              blocker.reset();
            }}
          >
            Stay
          </Button>
          <Button
            size="sm"
            onClick={() => {
              skipBlock.current = true;
              blocker.proceed();
            }}
          >
            Leave
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BackLink({ entry }: { entry: EntryDetail }) {
  const model = useContentModel();
  const type = model.data?.contentTypes.find((candidate) => candidate.id === entry.contentTypeId);
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to={type ? `/content/${type.key}/${entry.id}` : '/'}>
        <ArrowLeft aria-hidden="true" /> Back
      </Link>
    </Button>
  );
}

/** Full-screen visual builder for one entry (route: /content/:type/:id/builder). */
export function BuilderPage() {
  const { type: typeKey = '', id = '' } = useParams();
  const model = useContentModel();
  const entry = useEntry(id);
  const type = model.data?.contentTypes.find((candidate) => candidate.key === typeKey);
  if (model.isPending || entry.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-96" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (!type || entry.isError || !type.hasBuilder) {
    return <NotFoundPage />;
  }
  return <Editor entry={entry.data} typeName={type.name} />;
}
