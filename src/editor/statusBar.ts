/**
 * src/editor/statusBar.ts — Powerline status bar DOM element
 * Renders a fancy Vim-style status bar below the CodeMirror editor.
 * Updates via EditorView.updateListener extension.
 */

import type { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';

// ─── CSS (injected once) ──────────────────────────────────────────────────────

// Flat Neovim-style status line (restyle/portfolio-style-guide.md): the mode
// block is the one earned color fill; everything else is dim text on bg-elev.
const CSS = `
.powerline-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  padding: 0 0;
  background: var(--bg-elev, #16161a);
  border-top: 1px solid var(--border, #1f1f22);
  font-family: 'JetBrains Mono', 'Symbols Nerd Font', monospace;
  font-size: 11px;
  color: var(--dim, #6b6b6b);
  overflow: hidden;
  flex-shrink: 0;
  transition: background 0.15s ease;
  user-select: none;
}

.powerline-bar.loading {
  background: var(--selection, #2a2a2d);
}

.powerline-segment {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 0;
}

.powerline-mode {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 8px;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.powerline-mode[data-mode="NORMAL"] {
  background: #7c9885;
  color: #0e0e10;
}

.powerline-mode[data-mode="INSERT"] {
  background: #8ba3c4;
  color: #0e0e10;
  animation: insert-flash 0.5s ease-out;
}

.powerline-mode[data-mode="VISUAL"] {
  background: #a08ca8;
  color: #0e0e10;
}

@keyframes insert-flash {
  0%   { opacity: 1; }
  30%  { opacity: 0.5; }
  100% { opacity: 1; }
}

.powerline-filepath {
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
  color: var(--dim, #6b6b6b);
  font-size: 11px;
}

.powerline-ro {
  padding: 0 2px;
  color: var(--dim, #6b6b6b);
  font-size: 11px;
}

.powerline-toggle {
  padding: 0 8px;
  color: var(--accent, #9aa5b1);
  cursor: pointer;
  font-size: 11px;
}

.powerline-toggle:hover {
  color: var(--fg-bright, #e2e2dc);
}

.powerline-filetype {
  padding: 0 6px;
  color: var(--dim, #6b6b6b);
  font-size: 11px;
}

.powerline-linecol {
  padding: 0 6px;
  color: var(--dim, #6b6b6b);
  font-size: 11px;
}

.powerline-scrollpct {
  padding: 0 8px 0 0;
  color: var(--dim, #6b6b6b);
  font-size: 11px;
}

.powerline-hint {
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dim, #6b6b6b);
  font-style: italic;
  font-size: 10px;
}

@keyframes powerline-pulse {
  0%, 100% { opacity: 0.45; }
  50%       { opacity: 0.15; }
}

.powerline-cursor {
  color: var(--fg-main, #c8c8c2);
  animation: powerline-pulse 2.8s ease-in-out infinite;
  font-style: normal;
  font-size: 12px;
  line-height: 1;
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

// ─── PowerlineBar class ───────────────────────────────────────────────────────

export class PowerlineBar {
  private readonly element: HTMLElement;
  private currentFile: string = 'index.md';
  private currentMode: string = 'NORMAL';
  private prevMode: string = 'NORMAL';
  private surface: 'source' | 'preview' = 'source';
  private lastPos = { lineNum: 1, colNum: 1, scrollPct: 0 };

  /** Invoked when the user clicks the [preview]/[source] toggle. */
  onToggleView?: () => void;

  constructor(element: HTMLElement) {
    this.element = element;
    element.className = 'powerline-bar';
    injectCSS();
    // Delegated click — render() rewrites innerHTML, so listeners can't live
    // on the toggle span itself.
    element.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.powerline-toggle')) {
        this.onToggleView?.();
      }
    });
    this.render('NORMAL', 'index.md', 1, 1, 0);
  }

  /** Called when the editor loads a new file. */
  setFile(path: string): void {
    this.currentFile = path;
  }

  /** Tell the bar which surface is showing: raw source or rendered preview. */
  setSurface(surface: 'source' | 'preview'): void {
    if (this.surface === surface) return;
    this.surface = surface;
    const { lineNum, colNum, scrollPct } = this.lastPos;
    this.render(this.currentMode, this.currentFile, lineNum, colNum, scrollPct);
  }

  /** Mark the bar as loading (background shift). */
  setLoading(loading: boolean): void {
    if (loading) {
      this.element.classList.add('loading');
    } else {
      this.element.classList.remove('loading');
    }
  }

  /**
   * Update the status bar from a CodeMirror ViewUpdate.
   * Called by the EditorView.updateListener extension.
   */
  updateFromView(update: ViewUpdate): void {
    const state = update.state;
    const view = update.view;

    // Detect vim mode via getCM (codemirror-vim's CM5 shim)
    let mode = 'NORMAL';
    const cm = getCM(view);
    if (cm) {
      const vimState = (cm.state as { vim?: { insertMode?: boolean; visualMode?: boolean } }).vim;
      if (vimState) {
        if (vimState.insertMode) mode = 'INSERT';
        else if (vimState.visualMode) mode = 'VISUAL';
        else mode = 'NORMAL';
      }
    }

    if (mode !== this.prevMode) {
      this.prevMode = mode;
      this.currentMode = mode;
    }

    const { lineNum, colNum, scrollPct } = this.getPositionInfo(state, view);
    this.render(this.currentMode, this.currentFile, lineNum, colNum, scrollPct);
  }

  /**
   * Full manual update — can be called without a ViewUpdate.
   */
  update(state: EditorState, view: EditorView): void {
    let mode = 'NORMAL';
    const cm = getCM(view);
    if (cm) {
      const vimState = (cm.state as { vim?: { insertMode?: boolean; visualMode?: boolean } }).vim;
      if (vimState) {
        if (vimState.insertMode) mode = 'INSERT';
        else if (vimState.visualMode) mode = 'VISUAL';
        else mode = 'NORMAL';
      }
    }
    this.currentMode = mode;
    const { lineNum, colNum, scrollPct } = this.getPositionInfo(state, view);
    this.render(mode, this.currentFile, lineNum, colNum, scrollPct);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private getPositionInfo(state: EditorState, view: EditorView): {
    lineNum: number; colNum: number; scrollPct: number;
  } {
    const selection = state.selection.main;
    const line = state.doc.lineAt(selection.from);
    const lineNum = line.number;
    const colNum = selection.from - line.from + 1;

    const totalLines = state.doc.lines;
    let scrollPct = 0;
    if (totalLines > 0) {
      // Use the visible range from the scroll DOM if available
      try {
        const visibleRanges = view.visibleRanges;
        if (visibleRanges.length > 0) {
          const topLine = state.doc.lineAt(visibleRanges[0].from).number;
          scrollPct = Math.round((topLine / totalLines) * 100);
        } else {
          scrollPct = Math.round((lineNum / totalLines) * 100);
        }
      } catch {
        scrollPct = Math.round((lineNum / totalLines) * 100);
      }
    }
    scrollPct = Math.max(0, Math.min(100, scrollPct)) || 0;  // guard against NaN

    return { lineNum, colNum, scrollPct };
  }

  private render(
    mode: string,
    filePath: string,
    lineNum: number,
    colNum: number,
    scrollPct: number,
  ): void {
    this.lastPos = { lineNum, colNum, scrollPct };
    const fileType = filePath.endsWith('.md') ? 'markdown' : 'text';

    // Scroll label
    let scrollLabel: string;
    if (scrollPct <= 0) scrollLabel = 'Top';
    else if (scrollPct >= 99) scrollLabel = 'Bot';
    else scrollLabel = `${scrollPct}%`;

    const hint = this.surface === 'preview'
      ? `<span class="powerline-hint"><span class="powerline-cursor">▋</span> press i to edit</span>`
      : '';
    const toggleLabel = this.surface === 'source' ? '[preview]' : '[source]';
    const toggleTitle = this.surface === 'source'
      ? 'Show rendered preview (:preview)'
      : 'Show raw markdown (press i)';

    this.element.innerHTML = `
      <div class="powerline-segment" style="height:100%">
        <span class="powerline-mode" data-mode="${escapeHtml(mode)}"> ${escapeHtml(mode)} </span>
        <span class="powerline-filepath" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>
        <span class="powerline-ro">[RO]</span>
      </div>
      <div class="powerline-segment" style="height:100%">
        ${hint}
        <span class="powerline-toggle" role="button" tabindex="0" title="${escapeHtml(toggleTitle)}">${escapeHtml(toggleLabel)}</span>
        <span class="powerline-filetype">${escapeHtml(fileType)} · utf-8</span>
        <span class="powerline-linecol">${lineNum}:${colNum}</span>
        <span class="powerline-scrollpct">${scrollLabel}</span>
      </div>
    `;
  }
}

// ─── EditorView extension factory ────────────────────────────────────────────

/**
 * Create a CodeMirror extension that keeps a PowerlineBar in sync
 * with every editor state change.
 */
export function powerlineBarExtension(bar: PowerlineBar): ReturnType<typeof EditorView.updateListener.of> {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    bar.updateFromView(update);
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
