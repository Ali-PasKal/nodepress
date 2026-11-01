import type { Breakpoint, BuilderDocument } from '@nexora/shared';
import { create } from 'zustand';

const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 1_500;

interface BuilderState {
  document: BuilderDocument;
  /** Document as last saved (for the unsaved-changes indicator). */
  saved: string;
  selectedId: string | null;
  device: Breakpoint;
  past: BuilderDocument[];
  future: BuilderDocument[];
  /** Resets the editor to a document (load or after a conflict reload). */
  load: (document: BuilderDocument) => void;
  /**
   * Applies a change as one undoable step. Consecutive changes with the same `mergeKey` within a short time
   * (typing in one field) are merged into a single step.
   */
  apply: (
    change: (document: BuilderDocument) => BuilderDocument,
    select?: string | null,
    mergeKey?: string,
  ) => void;
  lastMerge: { key: string; at: number } | null;
  select: (id: string | null) => void;
  setDevice: (device: Breakpoint) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (document: BuilderDocument) => void;
}

/** Editor state: the document, selection, device preview and an undo/redo history of whole documents. */
export const useBuilderStore = create<BuilderState>()((set) => ({
  document: { schemaVersion: 1, settings: { hideTitle: false }, sections: [] },
  saved: '',
  selectedId: null,
  device: 'desktop',
  past: [],
  future: [],
  lastMerge: null,
  load: (document) => {
    set({
      document,
      saved: JSON.stringify(document),
      selectedId: null,
      past: [],
      future: [],
      lastMerge: null,
    });
  },
  apply: (change, select, mergeKey) => {
    set((state) => {
      const next = change(state.document);
      if (next === state.document) return state;
      const now = Date.now();
      const merge =
        mergeKey !== undefined &&
        state.lastMerge?.key === mergeKey &&
        now - state.lastMerge.at < MERGE_WINDOW_MS;
      return {
        document: next,
        past: merge ? state.past : [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: [],
        lastMerge: mergeKey !== undefined ? { key: mergeKey, at: now } : null,
        ...(select !== undefined ? { selectedId: select } : {}),
      };
    });
  },
  select: (id) => {
    set({ selectedId: id });
  },
  setDevice: (device) => {
    set({ device });
  },
  undo: () => {
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future],
        lastMerge: null,
      };
    });
  },
  redo: () => {
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        document: next,
        past: [...state.past, state.document],
        future: rest,
        lastMerge: null,
      };
    });
  },
  markSaved: (document) => {
    set({ saved: JSON.stringify(document) });
  },
}));

export function useIsDirty(): boolean {
  return useBuilderStore((state) => JSON.stringify(state.document) !== state.saved);
}
