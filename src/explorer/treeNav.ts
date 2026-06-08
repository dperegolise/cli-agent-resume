/**
 * src/explorer/treeNav.ts — Keyboard navigation manager for the NERDTree explorer.
 * Manages j/k/Enter/Escape via the FileExplorer's existing onKeyDown handler,
 * but also exposes a standalone TreeNavigator class for external use.
 * Owned by milestone m4-vim-panel.
 */

import { bus, EVENT_TYPES } from '../bus.js';
import type { FocusFileEvent } from '../types.js';

// ─── TreeNavigator class ──────────────────────────────────────────────────────

/**
 * Manages keyboard focus and navigation state for a NERDTree DOM element.
 * Delegates actual DOM mutations to the FileExplorer via bus emissions.
 *
 * Usage:
 *   const nav = new TreeNavigator();
 *   nav.attach(treeElement);
 *   // later:
 *   nav.detach();
 */
export class TreeNavigator {
  private treeElement: HTMLElement | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private items: HTMLElement[] = [];
  private cursor = -1;

  /**
   * Attach the navigator to a rendered NERDTree element.
   * Rebuilds the flat item list and listens for keyboard events.
   */
  attach(treeElement: HTMLElement): void {
    this.detach();
    this.treeElement = treeElement;
    this.refreshItems();

    this.boundKeyDown = this.handleKeyDown.bind(this);
    treeElement.addEventListener('keydown', this.boundKeyDown);
    treeElement.tabIndex = 0;
  }

  /** Detach from the current tree element. */
  detach(): void {
    if (this.treeElement && this.boundKeyDown) {
      this.treeElement.removeEventListener('keydown', this.boundKeyDown);
    }
    this.treeElement = null;
    this.boundKeyDown = null;
    this.items = [];
    this.cursor = -1;
  }

  /**
   * Move cursor up or down by `delta` steps.
   * Only counts visible items.
   */
  moveCursor(direction: 'up' | 'down'): void {
    this.refreshItems();
    if (this.items.length === 0) return;
    const delta = direction === 'down' ? 1 : -1;
    const next = this.cursor + delta;
    this.setCursor(next);
  }

  /**
   * Emit FOCUS_FILE for the currently selected item.
   */
  selectCurrent(): void {
    if (this.cursor < 0 || this.cursor >= this.items.length) return;
    const item = this.items[this.cursor];
    const path = item.dataset['path'];
    if (path) {
      this.setSelected(item);
      bus.emit<FocusFileEvent>(EVENT_TYPES.FOCUS_FILE, {
        path,
        triggerSource: 'explorer',
      });
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private refreshItems(): void {
    if (!this.treeElement) return;
    // Collect all visible file items (those with data-path)
    this.items = Array.from(
      this.treeElement.querySelectorAll<HTMLElement>('.tree-item[data-path]'),
    ).filter(el => !isInsideCollapsed(el));
  }

  private setCursor(idx: number): void {
    if (this.items.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, this.items.length - 1));
    this.cursor = clamped;
    const item = this.items[clamped];
    this.setSelected(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  private setSelected(el: HTMLElement): void {
    // Remove previous selection
    this.treeElement?.querySelectorAll('.tree-item.selected').forEach(
      (prev) => prev.classList.remove('selected'),
    );
    el.classList.add('selected');
    this.cursor = this.items.indexOf(el);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'j':
        e.preventDefault();
        e.stopPropagation();
        this.moveCursor('down');
        break;
      case 'k':
        e.preventDefault();
        e.stopPropagation();
        this.moveCursor('up');
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.selectCurrent();
        break;
      default:
        break;
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Check if an element is inside a collapsed `.tree-children` container.
 */
function isInsideCollapsed(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    if (cur.classList.contains('tree-children') && cur.classList.contains('collapsed')) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}
