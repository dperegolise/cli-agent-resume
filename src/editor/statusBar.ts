/**
 * src/editor/statusBar.ts — Powerline status bar DOM element
 * Renders a fancy Vim-style status bar below the CodeMirror editor.
 * Updates via EditorView.updateListener extension.
 */

import type { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';

// ─── Powerline glyph constants ────────────────────────────────────────────────

/** U+E0B0 — right-pointing filled triangle (powerline right separator) */
const SEP_RIGHT = '';
/** U+E0B2 — left-pointing filled triangle (powerline left separator) */
const SEP_LEFT = '';

// ─── CSS (injected once) ──────────────────────────────────────────────────────

const CSS = `
.powerline-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  padding: 0 0;
  background: var(--bg-main, #1d2021);
  border-top: 1px solid var(--tmux-green, #44ff88);
  font-family: 'JetBrains Mono', 'Symbols Nerd Font', monospace;
  font-size: 11px;
  color: var(--fg-main, #ebdbb2);
  overflow: hidden;
  flex-shrink: 0;
  transition: background 0.15s ease;
  user-select: none;
}

.powerline-bar.loading {
  background: var(--ansi-8, #928374);
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
  font-weight: bold;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.powerline-mode[data-mode="NORMAL"] {
  background: #b8bb26;
  color: #282828;
}

.powerline-mode[data-mode="INSERT"] {
  background: #fabd2f;
  color: #282828;
  animation: insert-flash 0.5s ease-out;
}

.powerline-mode[data-mode="VISUAL"] {
  background: #8ec07c;
  color: #282828;
}

@keyframes insert-flash {
  0%   { opacity: 1; }
  30%  { opacity: 0.5; }
  100% { opacity: 1; }
}

.powerline-sep {
  height: 100%;
  display: inline-flex;
  align-items: center;
  font-size: 18px;
  line-height: 1;
  padding: 0;
}

/* Right-side sep: color matches the mode pill */
.powerline-sep-mode-normal {
  color: #b8bb26;
  background: var(--bg-main, #1d2021);
}
.powerline-sep-mode-insert {
  color: #fabd2f;
  background: var(--bg-main, #1d2021);
}
.powerline-sep-mode-visual {
  color: #8ec07c;
  background: var(--bg-main, #1d2021);
}

.powerline-filepath {
  padding: 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
  color: var(--fg-main, #ebdbb2);
  font-size: 11px;
}

.powerline-ro {
  padding: 0 4px;
  color: #d65d0e;
  font-weight: bold;
  font-size: 10px;
}

.powerline-filetype {
  padding: 0 6px;
  color: #8ec07c;
  font-size: 10px;
}

.powerline-sep-right-accent {
  color: var(--ansi-8, #928374);
  background: var(--bg-main, #1d2021);
  height: 100%;
  display: inline-flex;
  align-items: center;
  font-size: 18px;
}

.powerline-linecol {
  padding: 0 6px;
  color: var(--fg-main, #ebdbb2);
  font-size: 11px;
}

.powerline-scrollpct {
  padding: 0 4px;
  color: var(--ansi-8, #928374);
  font-size: 10px;
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

  constructor(element: HTMLElement) {
    this.element = element;
    element.className = 'powerline-bar';
    injectCSS();
    this.render('NORMAL', 'index.md', 1, 1, 0);
  }

  /** Called when the editor loads a new file. */
  setFile(path: string): void {
    this.currentFile = path;
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
    scrollPct = Math.max(0, Math.min(100, scrollPct));

    return { lineNum, colNum, scrollPct };
  }

  private render(
    mode: string,
    filePath: string,
    lineNum: number,
    colNum: number,
    scrollPct: number,
  ): void {
    const fileType = filePath.endsWith('.md') ? 'markdown' : 'text';
    const sepClass = `powerline-sep-mode-${mode.toLowerCase()}`;

    // Scroll label
    let scrollLabel: string;
    if (scrollPct <= 0) scrollLabel = 'Top';
    else if (scrollPct >= 99) scrollLabel = 'Bot';
    else scrollLabel = `${scrollPct}%`;

    this.element.innerHTML = `
      <div class="powerline-segment" style="height:100%">
        <span class="powerline-mode" data-mode="${escapeHtml(mode)}"> ${escapeHtml(mode)} </span>
        <span class="powerline-sep ${escapeHtml(sepClass)}">${SEP_RIGHT}</span>
        <span class="powerline-filepath" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>
        <span class="powerline-ro">[RO]</span>
      </div>
      <div class="powerline-segment" style="height:100%">
        <span class="powerline-filetype">${escapeHtml(fileType)}</span>
        <span class="powerline-sep powerline-sep-right-accent">${SEP_LEFT}</span>
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
