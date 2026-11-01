import {
  builderDocumentSchema,
  createSection,
  createWidget,
  type BuilderDocument,
  type BuilderWidget,
} from '@nexora/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  duplicateElement,
  effectiveStyle,
  equalWidths,
  findElement,
  insertSection,
  insertWidget,
  moveElement,
  moveSection,
  moveWidget,
  removeElement,
  setColumnCount,
  updateElement,
  updateStyles,
  withoutKey,
} from './document-ops';
import { useBuilderStore } from './store';

function heading(text: string): BuilderWidget {
  const widget = createWidget('heading');
  widget.props.text = text;
  return widget;
}

/** Two sections: the first has two columns with widgets A, B | C; the second one empty column. */
function sample(): BuilderDocument {
  const first = createSection([50, 50]);
  first.children[0]?.children.push(heading('A'), heading('B'));
  first.children[1]?.children.push(heading('C'));
  const second = createSection([100]);
  return { schemaVersion: 1, settings: { hideTitle: false }, sections: [first, second] };
}

function texts(document: BuilderDocument, section = 0): string[][] {
  return (document.sections[section]?.children ?? []).map((column) =>
    column.children.map((widget) => (widget.widget === 'heading' ? widget.props.text : '?')),
  );
}

function idOf(document: BuilderDocument, text: string): string {
  for (const section of document.sections) {
    for (const column of section.children) {
      for (const widget of column.children) {
        if (widget.widget === 'heading' && widget.props.text === text) return widget.id;
      }
    }
  }
  throw new Error(`No heading ${text}`);
}

describe('builder document operations', () => {
  it('never mutates the input document and keeps documents valid', () => {
    const document = sample();
    const snapshot = JSON.stringify(document);
    const results = [
      removeElement(document, idOf(document, 'A')),
      duplicateElement(document, idOf(document, 'B')).document,
      moveElement(document, idOf(document, 'B'), -1),
      insertSection(document, 0, [33, 67]).document,
      moveWidget(document, idOf(document, 'A'), document.sections[1]?.children[0]?.id ?? '', 0),
      setColumnCount(document, document.sections[0]?.id ?? '', 3),
      updateStyles(document, idOf(document, 'C'), 'tablet', { paddingTop: 8 }),
    ];
    expect(JSON.stringify(document)).toBe(snapshot);
    for (const result of results) {
      expect(result).not.toBe(document);
      expect(builderDocumentSchema.safeParse(result).success).toBe(true);
    }
  });

  it('finds elements with their location', () => {
    const document = sample();
    const at = findElement(document, idOf(document, 'C'));
    expect(at).toMatchObject({ kind: 'widget', section: 0, column: 1, widget: 0 });
    expect(findElement(document, document.sections[1]?.id ?? '')).toMatchObject({
      kind: 'section',
      section: 1,
    });
    expect(findElement(document, 'missing0')).toBeNull();
  });

  it('updates one element', () => {
    const document = sample();
    const next = updateElement<BuilderWidget>(document, idOf(document, 'B'), (node) =>
      node.widget === 'heading' ? { ...node, props: { ...node.props, text: 'B2' } } : node,
    );
    expect(texts(next)).toEqual([['A', 'B2'], ['C']]);
    expect(updateElement(document, 'missing0', (node) => node)).toBe(document);
  });

  it('splits widths equally into 100', () => {
    expect(equalWidths(1)).toEqual([100]);
    expect(equalWidths(3)).toEqual([33, 33, 34]);
    expect(equalWidths(6).reduce((sum, width) => sum + width, 0)).toBe(100);
  });

  it('removes widgets, columns (re-balancing widths) and sections', () => {
    const document = sample();
    expect(texts(removeElement(document, idOf(document, 'A')))).toEqual([['B'], ['C']]);
    const withoutColumn = removeElement(document, document.sections[0]?.children[1]?.id ?? '');
    expect(texts(withoutColumn)).toEqual([['A', 'B']]);
    expect(withoutColumn.sections[0]?.children[0]?.width).toEqual({ desktop: 100 });
    // Removing the only column removes its section.
    const lastColumn = document.sections[1]?.children[0]?.id ?? '';
    expect(removeElement(document, lastColumn).sections).toHaveLength(1);
    expect(removeElement(document, document.sections[0]?.id ?? '').sections).toHaveLength(1);
  });

  it('duplicates with fresh ids right after the original', () => {
    const document = sample();
    const result = duplicateElement(document, idOf(document, 'A'));
    expect(texts(result.document)).toEqual([['A', 'A', 'B'], ['C']]);
    expect(result.id).not.toBe(idOf(document, 'A'));
    const section = duplicateElement(document, document.sections[0]?.id ?? '');
    expect(section.document.sections).toHaveLength(3);
    const ids = JSON.stringify(section.document).match(/"id":"[a-z0-9]{8}"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a seventh column', () => {
    const document: BuilderDocument = {
      ...sample(),
      sections: [createSection(equalWidths(6))],
    };
    const result = duplicateElement(document, document.sections[0]?.children[0]?.id ?? '');
    expect(result).toEqual({ document, id: null });
  });

  it('moves elements among siblings within bounds', () => {
    const document = sample();
    expect(texts(moveElement(document, idOf(document, 'B'), -1))).toEqual([['B', 'A'], ['C']]);
    expect(moveElement(document, idOf(document, 'A'), -1)).toBe(document);
    const swapped = moveElement(document, document.sections[0]?.children[0]?.id ?? '', 1);
    expect(texts(swapped)).toEqual([['C'], ['A', 'B']]);
    expect(moveSection(document, 0, 1).sections[1]?.id).toBe(document.sections[0]?.id);
  });

  it('inserts and moves widgets between and within columns', () => {
    const document = sample();
    const columnB = document.sections[0]?.children[1]?.id ?? '';
    expect(texts(insertWidget(document, columnB, 0, heading('N')))).toEqual([
      ['A', 'B'],
      ['N', 'C'],
    ]);
    expect(texts(insertWidget(document, columnB, 99, heading('N')))).toEqual([
      ['A', 'B'],
      ['C', 'N'],
    ]);
    // Only columns accept widgets.
    expect(insertWidget(document, idOf(document, 'A'), 0, heading('N'))).toBe(document);
    expect(texts(moveWidget(document, idOf(document, 'A'), columnB, 1))).toEqual([
      ['B'],
      ['C', 'A'],
    ]);
    // Within one column the index refers to the position before removal.
    const columnA = document.sections[0]?.children[0]?.id ?? '';
    expect(texts(moveWidget(document, idOf(document, 'A'), columnA, 2))).toEqual([
      ['B', 'A'],
      ['C'],
    ]);
  });

  it('changes the column count and keeps widgets of removed columns', () => {
    const document = sample();
    const sectionId = document.sections[0]?.id ?? '';
    const one = setColumnCount(document, sectionId, 1);
    expect(texts(one)).toEqual([['A', 'B', 'C']]);
    expect(one.sections[0]?.children[0]?.width).toEqual({ desktop: 100 });
    const three = setColumnCount(document, sectionId, 3);
    expect(three.sections[0]?.children.map((column) => column.width.desktop)).toEqual([33, 33, 34]);
    expect(setColumnCount(document, sectionId, 7)).toBe(document);
  });

  it('sets, inherits and clears responsive styles', () => {
    const document = sample();
    const id = idOf(document, 'A');
    let next = updateStyles(document, id, 'desktop', { paddingTop: 24, textAlign: 'center' });
    next = updateStyles(next, id, 'mobile', { paddingTop: 8 });
    const styles = (findElement(next, id)?.node as BuilderWidget).styles;
    expect(effectiveStyle(styles, 'tablet', 'paddingTop')).toBe(24);
    expect(effectiveStyle(styles, 'mobile', 'paddingTop')).toBe(8);
    expect(effectiveStyle(styles, 'mobile', 'textAlign')).toBe('center');
    // Clearing the only mobile value removes the breakpoint entirely.
    next = updateStyles(next, id, 'mobile', { paddingTop: undefined });
    const cleared = (findElement(next, id)?.node as BuilderWidget).styles;
    expect(cleared).toEqual({ desktop: { paddingTop: 24, textAlign: 'center' } });
  });

  it('copies objects without a key', () => {
    expect(withoutKey({ desktop: 50, tablet: 100 }, 'tablet')).toEqual({ desktop: 50 });
  });
});

describe('builder store history', () => {
  beforeEach(() => {
    useBuilderStore.getState().load({
      schemaVersion: 1,
      settings: { hideTitle: false },
      sections: [createSection([100])],
    });
  });

  const columnId = () => useBuilderStore.getState().document.sections[0]?.children[0]?.id ?? '';
  const count = () =>
    useBuilderStore.getState().document.sections[0]?.children[0]?.children.length ?? 0;

  it('undoes and redoes whole steps and tracks unsaved changes', () => {
    const store = useBuilderStore.getState();
    const saved = store.saved;
    store.apply((document) => insertWidget(document, columnId(), 0, heading('A')));
    store.apply((document) => insertWidget(document, columnId(), 0, heading('B')));
    expect(count()).toBe(2);
    expect(useBuilderStore.getState().saved).toBe(saved);
    useBuilderStore.getState().undo();
    expect(count()).toBe(1);
    useBuilderStore.getState().redo();
    expect(count()).toBe(2);
    useBuilderStore.getState().undo();
    useBuilderStore.getState().undo();
    expect(count()).toBe(0);
    expect(JSON.stringify(useBuilderStore.getState().document)).toBe(saved);
    // A new change clears the redo stack.
    useBuilderStore
      .getState()
      .apply((document) => insertWidget(document, columnId(), 0, heading('C')));
    expect(useBuilderStore.getState().future).toHaveLength(0);
  });

  it('merges quick edits of the same field into one step', () => {
    const widget = heading('A');
    useBuilderStore
      .getState()
      .apply((document) => insertWidget(document, columnId(), 0, widget), widget.id);
    for (const text of ['Ab', 'Abc', 'Abcd']) {
      useBuilderStore
        .getState()
        .apply(
          (document) =>
            updateElement<BuilderWidget>(document, widget.id, (node) =>
              node.widget === 'heading' ? { ...node, props: { ...node.props, text } } : node,
            ),
          undefined,
          `text:${widget.id}`,
        );
    }
    expect(useBuilderStore.getState().past).toHaveLength(2);
    useBuilderStore.getState().undo();
    const restored = useBuilderStore.getState().document.sections[0]?.children[0]?.children[0];
    expect(restored?.widget === 'heading' ? restored.props.text : '').toBe('A');
  });

  it('ignores changes that return the same document', () => {
    useBuilderStore.getState().apply((document) => document);
    expect(useBuilderStore.getState().past).toHaveLength(0);
  });
});
