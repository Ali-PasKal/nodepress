import {
  cloneWithNewIds,
  createColumn,
  createSection,
  type Breakpoint,
  type BuilderColumn,
  type BuilderDocument,
  type BuilderSection,
  type BuilderWidget,
  type StyleValues,
  type Styles,
} from '@nexora/shared';

/**
 * Pure, immutable operations on builder documents (the editor's store applies them and keeps the history).
 * Every function returns a new document and never mutates its input.
 */

export type ElementKind = 'section' | 'column' | 'widget';

/** Array access for locations that were just found (a miss means a bug, not user input). */
function nth<Item>(items: readonly Item[], index: number): Item {
  const item = items[index];
  if (item === undefined) throw new Error(`No element at index ${String(index)}.`);
  return item;
}
/** A copy of an object without one key (an inherited breakpoint value is stored as a missing key). */
export function withoutKey<Value extends object, Key extends keyof Value>(
  object: Value,
  key: Key,
): Omit<Value, Key> {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)) as Omit<
    Value,
    Key
  >;
}

export type BuilderElement = BuilderSection | BuilderColumn | BuilderWidget;

export interface Location {
  readonly kind: ElementKind;
  readonly node: BuilderElement;
  readonly section: number;
  readonly column: number;
  readonly widget: number;
}

export function findElement(document: BuilderDocument, id: string): Location | null {
  for (const [s, section] of document.sections.entries()) {
    if (section.id === id)
      return { kind: 'section', node: section, section: s, column: -1, widget: -1 };
    for (const [c, column] of section.children.entries()) {
      if (column.id === id)
        return { kind: 'column', node: column, section: s, column: c, widget: -1 };
      for (const [w, widget] of column.children.entries()) {
        if (widget.id === id)
          return { kind: 'widget', node: widget, section: s, column: c, widget: w };
      }
    }
  }
  return null;
}

function clone(document: BuilderDocument): BuilderDocument {
  return structuredClone(document);
}

/** Replaces one element (found by id) with the updater's result. */
export function updateElement<Node extends BuilderElement>(
  document: BuilderDocument,
  id: string,
  updater: (node: Node) => Node,
): BuilderDocument {
  const at = findElement(document, id);
  if (!at) return document;
  const next = clone(document);
  const section = nth(next.sections, at.section);
  if (at.kind === 'section') next.sections[at.section] = updater(section as Node) as BuilderSection;
  else if (at.kind === 'column')
    section.children[at.column] = updater(section.children[at.column] as Node) as BuilderColumn;
  else {
    const column = nth(section.children, at.column);
    column.children[at.widget] = updater(column.children[at.widget] as Node) as BuilderWidget;
  }
  return next;
}

/** Equal widths that add up to 100 (`3` → `[33, 33, 34]`). */
export function equalWidths(count: number): number[] {
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 100 - base * (count - 1) : base,
  );
}

export function removeElement(document: BuilderDocument, id: string): BuilderDocument {
  const at = findElement(document, id);
  if (!at) return document;
  const next = clone(document);
  if (at.kind === 'section') {
    next.sections.splice(at.section, 1);
    return next;
  }
  const section = nth(next.sections, at.section);
  if (at.kind === 'column') {
    // A section keeps at least one column; removing the last one removes the section.
    if (section.children.length === 1) {
      next.sections.splice(at.section, 1);
      return next;
    }
    section.children.splice(at.column, 1);
    equalWidths(section.children.length).forEach((width, index) => {
      nth(section.children, index).width = { desktop: width };
    });
    return next;
  }
  nth(section.children, at.column).children.splice(at.widget, 1);
  return next;
}

/** Inserts a copy (with fresh ids) right after the element; returns the new document and the copy's id. */
export function duplicateElement(
  document: BuilderDocument,
  id: string,
): { document: BuilderDocument; id: string | null } {
  const at = findElement(document, id);
  if (!at) return { document, id: null };
  const next = clone(document);
  if (at.kind === 'section') {
    const copy = cloneWithNewIds(nth(next.sections, at.section));
    next.sections.splice(at.section + 1, 0, copy);
    return { document: next, id: copy.id };
  }
  const section = nth(next.sections, at.section);
  if (at.kind === 'column') {
    if (section.children.length >= 6) return { document, id: null };
    const copy = cloneWithNewIds(nth(section.children, at.column));
    section.children.splice(at.column + 1, 0, copy);
    equalWidths(section.children.length).forEach((width, index) => {
      nth(section.children, index).width = { desktop: width };
    });
    return { document: next, id: copy.id };
  }
  const column = nth(section.children, at.column);
  const copy = cloneWithNewIds(nth(column.children, at.widget));
  column.children.splice(at.widget + 1, 0, copy);
  return { document: next, id: copy.id };
}

function moveInArray(items: unknown[], from: number, to: number): void {
  const [item] = items.splice(from, 1);
  if (item !== undefined) items.splice(Math.max(0, Math.min(to, items.length)), 0, item);
}

/** Moves an element one step up/down among its siblings (keyboard and button alternative to dragging). */
export function moveElement(
  document: BuilderDocument,
  id: string,
  offset: -1 | 1,
): BuilderDocument {
  const at = findElement(document, id);
  if (!at) return document;
  const next = clone(document);
  const siblings: unknown[] =
    at.kind === 'section'
      ? next.sections
      : at.kind === 'column'
        ? nth(next.sections, at.section).children
        : nth(nth(next.sections, at.section).children, at.column).children;
  const index = at.kind === 'section' ? at.section : at.kind === 'column' ? at.column : at.widget;
  const target = index + offset;
  if (target < 0 || target >= siblings.length) return document;
  moveInArray(siblings, index, target);
  return next;
}

export function insertSection(
  document: BuilderDocument,
  index: number,
  widths: readonly number[] = [100],
): { document: BuilderDocument; id: string } {
  const next = clone(document);
  const section = createSection(widths);
  next.sections.splice(Math.max(0, Math.min(index, next.sections.length)), 0, section);
  return { document: next, id: section.id };
}

/** Inserts a widget into a column at an index (end when the index is out of range). */
export function insertWidget(
  document: BuilderDocument,
  columnId: string,
  index: number,
  widget: BuilderWidget,
): BuilderDocument {
  const at = findElement(document, columnId);
  if (at?.kind !== 'column') return document;
  const next = clone(document);
  const column = nth(nth(next.sections, at.section).children, at.column);
  column.children.splice(Math.max(0, Math.min(index, column.children.length)), 0, widget);
  return next;
}

/** Moves a widget to a column (possibly another one) at an index. */
export function moveWidget(
  document: BuilderDocument,
  widgetId: string,
  columnId: string,
  index: number,
): BuilderDocument {
  const from = findElement(document, widgetId);
  const to = findElement(document, columnId);
  if (from?.kind !== 'widget' || to?.kind !== 'column') return document;
  const next = clone(document);
  const source = nth(nth(next.sections, from.section).children, from.column);
  const [widget] = source.children.splice(from.widget, 1);
  if (!widget) return document;
  const target = nth(nth(next.sections, to.section).children, to.column);
  const adjusted = source === target && from.widget < index ? index - 1 : index;
  target.children.splice(Math.max(0, Math.min(adjusted, target.children.length)), 0, widget);
  return next;
}

export function moveSection(document: BuilderDocument, from: number, to: number): BuilderDocument {
  if (from === to) return document;
  const next = clone(document);
  moveInArray(next.sections, from, to);
  return next;
}

/** Changes the number of columns (1–6) with equal widths; widgets of removed columns move to the last one. */
export function setColumnCount(
  document: BuilderDocument,
  sectionId: string,
  count: number,
): BuilderDocument {
  const at = findElement(document, sectionId);
  if (at?.kind !== 'section' || count < 1 || count > 6) return document;
  const next = clone(document);
  const section = nth(next.sections, at.section);
  while (section.children.length < count) section.children.push(createColumn());
  while (section.children.length > count) {
    const removed = section.children.pop();
    if (!removed) break;
    nth(section.children, section.children.length - 1).children.push(...removed.children);
  }
  equalWidths(count).forEach((width, index) => {
    nth(section.children, index).width = { desktop: width };
  });
  return next;
}

/** Sets style values for one breakpoint; `undefined` clears a value (it then inherits). */
export function updateStyles(
  document: BuilderDocument,
  id: string,
  breakpoint: Breakpoint,
  patch: Partial<Record<keyof StyleValues, StyleValues[keyof StyleValues] | undefined>>,
): BuilderDocument {
  return updateElement<BuilderElement>(document, id, (node) => {
    const merged: Record<string, unknown> = { ...(node.styles[breakpoint] ?? {}), ...patch };
    const values = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    ) as StyleValues;
    if (breakpoint !== 'desktop' && Object.keys(values).length === 0) {
      return { ...node, styles: withoutKey(node.styles, breakpoint) };
    }
    const styles: Styles = { ...node.styles, [breakpoint]: values };
    return { ...node, styles };
  });
}

/** The value in effect at a breakpoint (mobile inherits tablet, which inherits desktop). */
export function effectiveStyle<Key extends keyof StyleValues>(
  styles: Styles,
  breakpoint: Breakpoint,
  key: Key,
): StyleValues[Key] {
  const order: Breakpoint[] =
    breakpoint === 'mobile'
      ? ['mobile', 'tablet', 'desktop']
      : breakpoint === 'tablet'
        ? ['tablet', 'desktop']
        : ['desktop'];
  for (const level of order) {
    const value = styles[level]?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}
