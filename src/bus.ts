/**
 * src/bus.ts — Cross-panel event bus
 * STUB: owned by milestone m4-vim-panel.
 * Exports stubs with correct type signatures so other modules can import without errors.
 */

import type {
  FocusFileEvent,
  ThemeChangeEvent,
  EditorSyncEvent,
  ExplorerHighlightEvent,
  SearchResultsEvent,
} from './types.js';

// ─── Event type constants ─────────────────────────────────────────────────────

export const EVENT_TYPES = {
  FOCUS_FILE: 'focus:file',
  THEME_CHANGE: 'theme:change',
  EDITOR_SYNC: 'editor:sync',
  EXPLORER_HIGHLIGHT: 'explorer:highlight',
  SEARCH_RESULTS: 'search:results',
} as const;

export type EventTypeName = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ─── Payload type map ─────────────────────────────────────────────────────────

export interface EventPayloads {
  'focus:file': FocusFileEvent;
  'theme:change': ThemeChangeEvent;
  'editor:sync': EditorSyncEvent;
  'explorer:highlight': ExplorerHighlightEvent;
  'search:results': SearchResultsEvent;
}

// ─── EventBus class (stub — full implementation in m4) ────────────────────────

export class EventBus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit<T>(_eventType: string, _payload: T): void {
    // m4 will implement
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  subscribe<T>(_eventType: string, _callback: (_payload: T) => void): () => void {
    // m4 will implement; return a no-op unsubscribe
    return () => {};
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  once<T>(_eventType: string, _callback: (_payload: T) => void): void {
    // m4 will implement
  }
}

/** Global singleton event bus. */
export const bus = new EventBus();
