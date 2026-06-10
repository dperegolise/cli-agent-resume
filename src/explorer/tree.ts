/**
 * src/explorer/tree.ts — NERDTree-style file explorer DOM component
 * Builds a navigable tree from the static manifest.
 * Owned by milestone m4-vim-panel.
 */

import { loadManifest, getManifestEntry } from '../manifest.js';
import { bus, EVENT_TYPES } from '../bus.js';
import type { Manifest, ManifestEntry, FocusFileEvent, ExplorerHighlightEvent } from '../types.js';

// ─── Nerd Font icons ──────────────────────────────────────────────────────────

/** U+E5FF — nerd tree closed folder */
const ICON_DIR_CLOSED = '';
/** U+F07B — opened folder */
const ICON_DIR_OPEN = '';
/** U+F15B — generic file */
const ICON_FILE = '';
/** U+F48A — markdown file (nerd font) */
const ICON_MD = '';

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
.nerd-tree {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg-main, #1d2021);
  padding: 4px 0;
  font-family: 'JetBrains Mono', 'Symbols Nerd Font', monospace;
  font-size: 12px;
  color: var(--fg-main, #ebdbb2);
  outline: none;
}

.nerd-tree ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nerd-tree .tree-item {
  display: flex;
  align-items: center;
  padding: 2px 4px 2px 2px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  gap: 4px;
  user-select: none;
  position: relative;
}

.nerd-tree .tree-item::before {
  content: ' ';
  display: inline-block;
  width: 1ch;
  flex-shrink: 0;
  color: var(--tmux-green, #44ff88);
}

.nerd-tree .tree-item:hover::before {
  content: '>';
}

.nerd-tree .tree-item:hover {
  color: var(--tmux-green, #44ff88);
}

.nerd-tree .tree-item.selected::before {
  content: '>';
}

.nerd-tree .tree-item.selected {
  color: #d79921;
}

.nerd-tree .tree-item.selected .tree-icon {
  color: #d79921;
}

.nerd-tree .tree-icon {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ansi-4, #458588);
  font-family: 'Symbols Nerd Font', 'JetBrains Mono', monospace;
}

.nerd-tree .tree-icon.icon-md {
  color: #8ec07c;
}

.nerd-tree .tree-icon.icon-dir {
  color: #fabd2f;
}

.nerd-tree .tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* Indent nested items */
.nerd-tree .tree-children {
  margin-left: 14px;
}

.nerd-tree .tree-children.collapsed {
  display: none;
}

/* Help overlay */
.nerd-tree-help {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  background: #3c3836;
  border: 1px solid #504945;
  border-radius: 4px;
  padding: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #ebdbb2;
  z-index: 100;
}

.nerd-tree-help table {
  border-collapse: collapse;
  width: 100%;
}
.nerd-tree-help td {
  padding: 1px 6px;
}
.nerd-tree-help td:first-child {
  color: #b8bb26;
  font-weight: bold;
  white-space: nowrap;
}
.nerd-tree-help .help-close {
  float: right;
  cursor: pointer;
  color: #fb4934;
}
`;

let cssInjected = false;
function injectCSS(): void {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ─── Tree node types ──────────────────────────────────────────────────────────

interface DirNode {
  type: 'dir';
  name: string;
  children: TreeNode[];
  expanded: boolean;
}

interface FileNode {
  type: 'file';
  name: string;
  entry: ManifestEntry;
}

type TreeNode = DirNode | FileNode;

// ─── FileExplorer class ───────────────────────────────────────────────────────

export class FileExplorer {
  private container: HTMLElement | null = null;
  private _treeEl: HTMLElement | null = null;
  private _manifest: Manifest | null = null;
  private selectedPath: string | null = null;
  private flatItems: Array<{ path: string; el: HTMLElement }> = [];
  private _selectedIndex = -1;
  private unsubFocusFile: (() => void) | null = null;
  private unsubExplorerHighlight: (() => void) | null = null;

  /**
   * Render the file explorer into `element` using the given manifest.
   */
  render(element: HTMLElement, manifest: Manifest): void {
    this.container = element;
    this._manifest = manifest;
    injectCSS();

    const tree = this.buildTreeDOM(manifest);
    element.innerHTML = '';
    element.appendChild(tree);
    this._treeEl = tree;

    // Keyboard events on the container
    element.tabIndex = 0;
    element.addEventListener('keydown', this.onKeyDown.bind(this));

    // Subscribe to bus events
    this.unsubFocusFile = bus.subscribe<FocusFileEvent>(
      EVENT_TYPES.FOCUS_FILE,
      (event) => {
        this.highlight(event.path);
      },
    );
    this.unsubExplorerHighlight = bus.subscribe<ExplorerHighlightEvent>(
      EVENT_TYPES.EXPLORER_HIGHLIGHT,
      (event) => {
        this.highlight(event.path);
      },
    );
  }

  /**
   * Build the full NERDTree DOM element from a manifest.
   */
  buildTreeDOM(manifest: Manifest): HTMLElement {
    const root = document.createElement('div');
    root.className = 'nerd-tree';

    // Build internal tree structure
    const treeRoot = this.buildTreeStructure(manifest);

    // Build DOM from tree
    const ul = this.buildDOMList(treeRoot);
    root.appendChild(ul);

    return root;
  }

  /**
   * Highlight the item with the given path (called from bus events).
   */
  highlight(path: string): void {
    // Deselect current
    const prevEl = this.flatItems.find(i => i.path === this.selectedPath);
    if (prevEl) prevEl.el.classList.remove('selected');

    // Select new
    const item = this.flatItems.find(i => i.path === path);
    if (item) {
      item.el.classList.add('selected');
      this.selectedPath = path;
      this._selectedIndex = this.flatItems.indexOf(item);
      item.el.scrollIntoView({ block: 'nearest' });
    } else {
      this.selectedPath = path;
    }
  }

  /**
   * Return the currently selected file path (or null).
   */
  getSelectedPath(): string | null {
    return this.selectedPath;
  }

  /** Return the index of the currently selected item in the flat list. */
  getSelectedIndex(): number {
    return this._selectedIndex;
  }

  /** Return the underlying tree DOM element (for external inspection). */
  getTreeElement(): HTMLElement | null {
    return this._treeEl;
  }

  /** Return the manifest used to build this tree. */
  getManifest(): Manifest | null {
    return this._manifest;
  }

  /** Clean up subscriptions. */
  destroy(): void {
    this.unsubFocusFile?.();
    this.unsubExplorerHighlight?.();
  }

  // ─── Private: tree structure building ────────────────────────────────────────

  private buildTreeStructure(manifest: Manifest): DirNode {
    const root: DirNode = { type: 'dir', name: 'www', children: [], expanded: true };

    for (const entry of manifest.entries) {
      const parts = entry.path.split('/');
      let current: DirNode = root;

      // Navigate / create intermediate directories
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        let dir = current.children.find(
          (n): n is DirNode => n.type === 'dir' && n.name === dirName,
        );
        if (!dir) {
          dir = { type: 'dir', name: dirName, children: [], expanded: true };
          current.children.push(dir);
        }
        current = dir;
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      current.children.push({ type: 'file', name: fileName, entry });
    }

    // Sort: directories first, then files alphabetically
    this.sortTreeNode(root);
    return root;
  }

  private sortTreeNode(node: DirNode): void {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.type === 'dir') this.sortTreeNode(child);
    }
  }

  // ─── Private: DOM building ────────────────────────────────────────────────────

  private buildDOMList(node: DirNode, depth = 0): HTMLUListElement {
    const ul = document.createElement('ul');

    // Add root label for depth 0
    if (depth === 0) {
      const rootLi = document.createElement('li');
      const rootItem = document.createElement('div');
      rootItem.className = 'tree-item';
      rootItem.innerHTML = `<span class="tree-icon icon-dir">${ICON_DIR_OPEN}</span><span class="tree-label"><strong>${node.name}/</strong></span>`;
      rootLi.appendChild(rootItem);
      ul.appendChild(rootLi);
    }

    for (const child of node.children) {
      if (child.type === 'dir') {
        ul.appendChild(this.buildDirItem(child, depth + 1));
      } else {
        ul.appendChild(this.buildFileItem(child, depth + 1));
      }
    }

    return ul;
  }

  private buildDirItem(node: DirNode, depth: number): HTMLLIElement {
    const li = document.createElement('li');

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = `${depth * 10 + 4}px`;

    const iconEl = document.createElement('span');
    iconEl.className = 'tree-icon icon-dir';
    iconEl.textContent = node.expanded ? ICON_DIR_OPEN : ICON_DIR_CLOSED;

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-label';
    labelEl.textContent = `${node.name}/`;

    item.appendChild(iconEl);
    item.appendChild(labelEl);
    li.appendChild(item);

    // Children container
    const childrenUl = document.createElement('ul');
    childrenUl.className = `tree-children ${node.expanded ? '' : 'collapsed'}`;

    for (const child of node.children) {
      if (child.type === 'dir') {
        childrenUl.appendChild(this.buildDirItem(child, depth + 1));
      } else {
        childrenUl.appendChild(this.buildFileItem(child, depth + 1));
      }
    }
    li.appendChild(childrenUl);

    // Toggle on click
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      iconEl.textContent = node.expanded ? ICON_DIR_OPEN : ICON_DIR_CLOSED;
      childrenUl.classList.toggle('collapsed', !node.expanded);
    });

    return li;
  }

  private buildFileItem(node: FileNode, depth: number): HTMLLIElement {
    const li = document.createElement('li');

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = `${depth * 10 + 4}px`;
    item.dataset['path'] = node.entry.path;
    item.title = node.entry.title;

    const iconEl = document.createElement('span');
    const isMd = node.name.endsWith('.md');
    iconEl.className = `tree-icon ${isMd ? 'icon-md' : ''}`;
    iconEl.textContent = isMd ? ICON_MD : ICON_FILE;

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-label';
    labelEl.textContent = node.entry.title || node.name;

    item.appendChild(iconEl);
    item.appendChild(labelEl);
    li.appendChild(item);

    // Register in flatItems for keyboard navigation
    this.flatItems.push({ path: node.entry.path, el: item });

    // Click to open
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectItem(node.entry.path);
    });

    return li;
  }

  // ─── Private: selection / navigation ─────────────────────────────────────────

  private selectItem(path: string): void {
    this.highlight(path);
    bus.emit<FocusFileEvent>(EVENT_TYPES.FOCUS_FILE, {
      path,
      triggerSource: 'explorer',
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'j':
        e.preventDefault();
        this.moveSelection(1);
        break;
      case 'k':
        e.preventDefault();
        this.moveSelection(-1);
        break;
      case 'Enter':
        e.preventDefault();
        if (this.selectedPath) {
          this.selectItem(this.selectedPath);
        }
        break;
      case '?':
        e.preventDefault();
        this.showHelp();
        break;
      case 'Escape':
        this.hideHelp();
        break;
      default:
        break;
    }
  }

  private moveSelection(delta: number): void {
    const visibleItems = this.flatItems.filter(i => isVisible(i.el));
    if (visibleItems.length === 0) return;

    const currentIdx = visibleItems.findIndex(i => i.path === this.selectedPath);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = delta > 0 ? 0 : visibleItems.length - 1;
    } else {
      nextIdx = (currentIdx + delta + visibleItems.length) % visibleItems.length;
    }

    const next = visibleItems[nextIdx];
    if (next) {
      // Deselect old
      if (this.selectedPath) {
        const old = this.flatItems.find(i => i.path === this.selectedPath);
        old?.el.classList.remove('selected');
      }
      next.el.classList.add('selected');
      next.el.scrollIntoView({ block: 'nearest' });
      this.selectedPath = next.path;
      this._selectedIndex = this.flatItems.indexOf(next);
    }
  }

  // ─── Help overlay ─────────────────────────────────────────────────────────────

  private showHelp(): void {
    if (!this.container) return;
    let overlay = this.container.querySelector('.nerd-tree-help');
    if (overlay) return; // already shown

    const div = document.createElement('div');
    div.className = 'nerd-tree-help';
    div.innerHTML = `
      <span class="help-close" title="Close">✕</span>
      <strong>NERDTree Help</strong>
      <table>
        <tr><td>j/k</td><td>Move down/up</td></tr>
        <tr><td>Enter</td><td>Open file</td></tr>
        <tr><td>Click dir</td><td>Toggle expand</td></tr>
        <tr><td>?</td><td>Show this help</td></tr>
        <tr><td>Esc</td><td>Close help</td></tr>
      </table>
    `;
    const closeBtn = div.querySelector('.help-close');
    closeBtn?.addEventListener('click', () => div.remove());
    this.container.style.position = 'relative';
    this.container.appendChild(div);
  }

  private hideHelp(): void {
    this.container?.querySelector('.nerd-tree-help')?.remove();
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isVisible(el: HTMLElement): boolean {
  // An element is "visible" if none of its ancestors has display:none or
  // the collapsed class on a tree-children container
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.classList.contains('collapsed')) return false;
    if (window.getComputedStyle(cur).display === 'none') return false;
    cur = cur.parentElement;
  }
  return true;
}

// ─── Top-level init ───────────────────────────────────────────────────────────

/**
 * Initialize the file explorer panel.
 * Loads the manifest and renders the NERDTree.
 */
export async function initFileExplorerPanel(element: HTMLElement): Promise<FileExplorer> {
  const manifest = await loadManifest();
  const explorer = new FileExplorer();
  explorer.render(element, manifest);
  explorer.highlight('index.md');
  return explorer;
}

/**
 * Convenience: highlight a path without a reference to FileExplorer.
 */
export function highlightPath(explorer: FileExplorer, path: string): void {
  const entry = getManifestEntry(path);
  if (entry) explorer.highlight(path);
}
