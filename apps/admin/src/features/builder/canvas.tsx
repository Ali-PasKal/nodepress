import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  compileBuilderCss,
  type BuilderColumn,
  type BuilderSection,
  type BuilderWidget,
} from '@nexora/shared';
import { builderClassNames, WidgetView, type BuilderRenderContext } from '@nexora/theme-sdk';
import { cn } from '@nexora/ui';
import { GripVertical, Plus } from 'lucide-react';
import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { insertSection } from './document-ops';
import { DEVICE_WIDTHS, widgetLabel, type DragData } from './labels';
import { useBuilderStore } from './store';

/** Selection by click or keyboard (Enter/Space) without bubbling to the parent element. */
function selectHandlers(id: string, select: (id: string) => void) {
  return {
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      select(id);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        select(id);
      }
    },
  };
}

function CanvasWidget({
  widget,
  columnId,
  context,
}: {
  widget: BuilderWidget;
  columnId: string;
  context: BuilderRenderContext;
}) {
  const selected = useBuilderStore((state) => state.selectedId === widget.id);
  const select = useBuilderStore((state) => state.select);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    data: { kind: 'widget', columnId } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'nx-canvas-el nx-canvas-widget',
        selected && 'is-selected',
        isDragging && 'is-dragging',
      )}
      data-element={widget.id}
      {...attributes}
      {...listeners}
      aria-label={`${widgetLabel(widget.widget)} widget`}
      aria-pressed={selected}
      {...selectHandlers(widget.id, select)}
    >
      <span className="nx-canvas-tag">{widgetLabel(widget.widget)}</span>
      <WidgetView widget={widget} context={context} />
    </div>
  );
}

function CanvasColumn({
  column,
  context,
}: {
  column: BuilderColumn;
  context: BuilderRenderContext;
}) {
  const selected = useBuilderStore((state) => state.selectedId === column.id);
  const select = useBuilderStore((state) => state.select);
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { kind: 'column', columnId: column.id } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        builderClassNames.column(column),
        'nx-canvas-el nx-canvas-column',
        selected && 'is-selected',
        isOver && 'is-over',
      )}
      data-element={column.id}
      role="group"
      aria-label="Column"
      tabIndex={0}
      {...selectHandlers(column.id, select)}
    >
      <SortableContext
        items={column.children.map((widget) => widget.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.children.map((widget) => (
          <CanvasWidget key={widget.id} widget={widget} columnId={column.id} context={context} />
        ))}
      </SortableContext>
      {column.children.length === 0 ? (
        <div className="nx-canvas-empty">Drop a widget here</div>
      ) : null}
    </div>
  );
}

function CanvasSection({
  section,
  context,
}: {
  section: BuilderSection;
  context: BuilderRenderContext;
}) {
  const selected = useBuilderStore((state) => state.selectedId === section.id);
  const select = useBuilderStore((state) => state.select);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    data: { kind: 'section' } satisfies DragData,
  });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        builderClassNames.section(section),
        'nx-canvas-el nx-canvas-section',
        selected && 'is-selected',
        isDragging && 'is-dragging',
      )}
      data-element={section.id}
      aria-label="Section"
      tabIndex={0}
      {...selectHandlers(section.id, select)}
    >
      <button
        type="button"
        className="nx-canvas-handle"
        aria-label="Drag section"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" />
      </button>
      <div className={builderClassNames.row}>
        {section.children.map((column) => (
          <CanvasColumn key={column.id} column={column} context={context} />
        ))}
      </div>
    </section>
  );
}

const LAYOUTS: { label: string; widths: number[] }[] = [
  { label: '1 column', widths: [100] },
  { label: '2 columns', widths: [50, 50] },
  { label: '3 columns', widths: [33, 33, 34] },
  { label: '2 columns (⅓ + ⅔)', widths: [33, 67] },
];

export function AddSectionBar({ index }: { index: number }) {
  const apply = useBuilderStore((state) => state.apply);
  return (
    <div className="nx-canvas-add" role="group" aria-label="Add a section">
      <Plus aria-hidden="true" className="size-4" />
      {LAYOUTS.map((layout) => (
        <button
          key={layout.label}
          type="button"
          onClick={(event) => {
            // The canvas background clears the selection on click; the new section stays selected.
            event.stopPropagation();
            let id = '';
            apply((document) => {
              const result = insertSection(document, index, layout.widths);
              id = result.id;
              return result.document;
            });
            useBuilderStore.getState().select(id);
          }}
        >
          {layout.label}
        </button>
      ))}
    </div>
  );
}

/** The page as visitors will see it (same components and CSS), with selection and drag handles. */
export function Canvas({ context }: { context: BuilderRenderContext }) {
  const document = useBuilderStore((state) => state.document);
  const device = useBuilderStore((state) => state.device);
  const select = useBuilderStore((state) => state.select);
  const css = useMemo(() => compileBuilderCss(document), [document]);
  return (
    <div
      className="nx-canvas-scroll"
      onClick={() => {
        select(null);
      }}
    >
      <div
        className="nx-canvas-frame nx-site-scope"
        style={{ width: DEVICE_WIDTHS[device] }}
        data-device={device}
      >
        <style>{css}</style>
        <div className={builderClassNames.root}>
          <SortableContext
            items={document.sections.map((section) => section.id)}
            strategy={verticalListSortingStrategy}
          >
            {document.sections.map((section) => (
              <CanvasSection key={section.id} section={section} context={context} />
            ))}
          </SortableContext>
        </div>
        <AddSectionBar index={document.sections.length} />
      </div>
    </div>
  );
}
