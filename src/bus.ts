/**
 * src/bus.ts — Cross-panel event bus
 * Real implementation: simple Map-based pub/sub singleton.
 * Owned by milestone m4-vim-panel.
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

// ─── EventBus class ───────────────────────────────────────────────────────────

type HandlerFn = (payload: unknown) => void;

export class EventBus {
  /** Map of event type → set of listener functions. */
  private readonly listeners: Map<string, Set<HandlerFn>> = new Map();

  /**
   * Emit an event to all subscribers.
   * Iterates a snapshot so handlers can safely unsubscribe during emission.
   */
  emit<T>(eventType: string, payload: T): void {
    const handlers = this.listeners.get(eventType);
    if (!handlers || handlers.size === 0) return;
    for (const handler of Array.from(handlers)) {
      try {
        handler(payload as unknown);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${eventType}":`, err);
      }
    }
  }

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function — call it to remove the listener.
   */
  subscribe<T>(eventType: string, callback: (payload: T) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    const handler = callback as HandlerFn;
    this.listeners.get(eventType)!.add(handler);
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  /**
   * Subscribe to exactly one emission, then auto-unsubscribe.
   */
  once<T>(eventType: string, callback: (payload: T) => void): void {
    const unsub = this.subscribe<T>(eventType, (payload) => {
      unsub();
      callback(payload);
    });
  }

  /**
   * Remove all listeners for a given event type, or all events if omitted.
   * Useful for cleanup / hot module reload.
   */
  clear(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }
}

/** Global singleton event bus. */
export const bus = new EventBus();
