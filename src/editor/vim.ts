/**
 * src/editor/vim.ts — CodeMirror 6 + Vim keybindings, read-only Markdown viewer
 * Owned by milestone m4-vim-panel.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { marked } from 'marked';
import { bus, EVENT_TYPES } from '../bus.js';
import { loadFile, getDefaultFile } from './fileLoader.js';
import { PowerlineBar, powerlineBarExtension } from './statusBar.js';
import { GRUVBOX_DARK } from '../theme.js';
import type { FocusFileEvent } from '../types.js';

// ─── Gruvbox syntax highlight style ──────────────────────────────────────────

const gruvboxHighlight = HighlightStyle.define([
  // Headings: red → yellow → green by level
  { tag: t.heading1,       color: '#fb4934', fontWeight: 'bold' },
  { tag: t.heading2,       color: '#fabd2f', fontWeight: 'bold' },
  { tag: t.heading3,       color: '#b8bb26', fontWeight: 'bold' },
  { tag: t.heading,        color: '#fe8019', fontWeight: 'bold' },
  // Emphasis / strong
  { tag: t.emphasis,       color: '#d3869b', fontStyle: 'italic' },
  { tag: t.strong,         color: '#ebdbb2', fontWeight: 'bold' },
  // Links
  { tag: t.link,           color: '#83a598', textDecoration: 'underline' },
  { tag: t.url,            color: '#8ec07c' },
  // Code
  { tag: t.monospace,      color: '#8ec07c', fontFamily: "'JetBrains Mono', monospace" },
  { tag: t.contentSeparator, color: '#928374' },
  // Quotes / comments
  { tag: t.comment,        color: '#928374', fontStyle: 'italic' },
  { tag: t.blockComment,   color: '#928374', fontStyle: 'italic' },
  // Lists / punctuation
  { tag: t.list,           color: '#fe8019' },
  { tag: t.punctuation,    color: '#a89984' },
  { tag: t.processingInstruction, color: '#d3869b' },
  // Strings / atoms
  { tag: t.string,         color: '#b8bb26' },
  { tag: t.atom,           color: '#d3869b' },
  // Keywords / operators (for embedded code blocks)
  { tag: t.keyword,        color: '#fb4934' },
  { tag: t.operator,       color: '#8ec07c' },
  { tag: t.number,         color: '#d3869b' },
  { tag: t.bool,           color: '#d3869b' },
  { tag: t.variableName,   color: '#83a598' },
  { tag: t.function(t.variableName), color: '#b8bb26' },
  { tag: t.typeName,       color: '#fabd2f' },
  { tag: t.className,      color: '#fabd2f' },
  { tag: t.propertyName,   color: '#83a598' },
  { tag: t.tagName,        color: '#fb4934' },
  { tag: t.attributeName,  color: '#fabd2f' },
  { tag: t.attributeValue, color: '#b8bb26' },
]);

// ─── Gruvbox CodeMirror theme ─────────────────────────────────────────────────

const gruvboxTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: GRUVBOX_DARK.colors.bg,
      color: GRUVBOX_DARK.colors.fg,
      fontFamily: "'JetBrains Mono', 'Symbols Nerd Font', monospace",
      fontSize: '13px',
    },
    '.cm-content': {
      caretColor: GRUVBOX_DARK.colors.cursor,
      padding: '4px 8px',
    },
    '.cm-cursor': {
      borderLeftColor: GRUVBOX_DARK.colors.cursor,
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: GRUVBOX_DARK.colors.ansi[0],
      color: GRUVBOX_DARK.colors.ansi[8],
      borderRight: `1px solid ${GRUVBOX_DARK.colors.selection}`,
    },
    '.cm-activeLineGutter': { backgroundColor: '#3c3836' },
    '.cm-activeLine':       { backgroundColor: '#3c3836' },
    '.cm-scroller':         { overflow: 'auto' },
    '.cm-vim-panel':        { background: '#1d2021', color: '#ebdbb2', padding: '0 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', minHeight: '1.4em', borderTop: '1px solid #504945' },
    '.cm-vim-panel input':  { background: 'transparent', color: '#ebdbb2', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', outline: 'none', border: 'none', width: '100%' },
  },
  { dark: true },
);

// Inject selection highlight as a real stylesheet so it beats the vim plugin's
// `background-color: transparent !important` on ::selection. EditorView.theme()
// loses that specificity war; a <style> tag added to <head> wins it.
(function injectSelectionStyle() {
  if (document.getElementById('cm-gruvbox-selection')) return;
  const s = document.createElement('style');
  s.id = 'cm-gruvbox-selection';
  s.textContent = `.cm-selectionBackground { background-color: #665c54 !important; }
.cm-focused .cm-selectionBackground { background-color: #665c54 !important; }`;
  document.head.appendChild(s);
})();

// ─── VimEditor class ──────────────────────────────────────────────────────────

// Configure marked once — no need for a full sanitiser since content is
// our own static portfolio files, never user-supplied HTML.
marked.setOptions({ async: false });

export class VimEditor {
  private view: EditorView | null = null;
  private statusBar: PowerlineBar | null = null;
  private _currentFile: string = 'index.md';

  private _previewEl: HTMLElement | null = null;
  private _hintEl: HTMLElement | null = null;
  private _editorEl: HTMLElement | null = null;
  private _inNormalMode: boolean = true;
  private unsubscribeFocusFile: (() => void) | null = null;

  /**
   * Create and mount the editor into `element`.
   * `statusBarElement` receives the PowerlineBar DOM.
   */
  create(element: HTMLElement, statusBarElement: HTMLElement): void {
    this.statusBar = new PowerlineBar(statusBarElement);
    this._editorEl = element;
    this._previewEl = document.getElementById('md-preview');
    // Make the preview focusable so it receives keydown events when clicked
    this._previewEl?.setAttribute('tabindex', '-1');

    // Build the pulsing cursor element (hint text moved to powerline bar)
    const wrap = element.closest<HTMLElement>('#vim-editor-wrap');
    if (wrap) {
      const hint = document.createElement('div');
      hint.id = 'vim-mode-hint';
      hint.innerHTML = '<span class="cursor">▋</span>';
      wrap.appendChild(hint);
      this._hintEl = hint;
    }

    const extensions = [
      // Full vim emulation — insert mode, visual mode, operators, registers, macros
      vim({ status: false }),
      // Undo/redo history — required for vim's u / Ctrl-r to work
      history(),
      // Draw CM6's selection layer — vim suppresses native ::selection but relies on this
      drawSelection(),
      // Markdown language support + embedded language highlighting
      markdown(),
      // Gruvbox color theme
      gruvboxTheme,
      // Syntax highlighting (must come after the language extension)
      syntaxHighlighting(gruvboxHighlight),
      // Status bar updater
      powerlineBarExtension(this.statusBar),
      // Line wrapping
      EditorView.lineWrapping,
    ];

    this.view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions,
      }),
      parent: element,
    });

    // Override :w, :wq, :x, :q to be no-ops or graceful
    this.patchVimCommands();

    // Switch to the editor only when the user explicitly enters insert mode (i, a, o…).
    // Visual mode (mouse selection) is allowed in preview without switching surfaces.
    const cm = getCM(this.view);
    if (cm) {
      cm.on('vim-mode-change', ({ mode }: { mode: string }) => {
        if (mode === 'insert' && this._inNormalMode) {
          this._setMode(false);
        }
      });
    }

    // While in preview mode the CM editor is behind the overlay and doesn't
    // receive keyboard events. Forward insert-mode trigger keys (i, a, o, O, A,
    // s, c, R…) to the editor so pressing i still enters vim insert mode.
    this._previewEl?.addEventListener('keydown', (e) => {
      if (!this._inNormalMode || !this.view) return;
      const INSERT_TRIGGERS = new Set(['i', 'a', 'o', 'O', 'A', 's', 'S', 'R', 'c', 'C']);
      if (INSERT_TRIGGERS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.view.focus();
        const cm = getCM(this.view);
        if (cm) Vim.handleKey(cm, e.key, 'mapping');
      }
    });

    // Intercept clicks on links inside the preview panel
    this._previewEl?.addEventListener('click', (e) => {
      const target = (e.target as Element).closest('a');
      if (!target) return;
      e.preventDefault();
      const href = target.getAttribute('href') ?? '';
      if (!href || href.startsWith('http://') || href.startsWith('https://')) {
        if (href) window.open(href, '_blank', 'noopener');
        return;
      }
      // Internal link — treat as a FOCUS_FILE path
      const path = href.replace(/^\//, '');
      bus.emit(EVENT_TYPES.FOCUS_FILE, { path, triggerSource: 'preview' });
    });

    // Subscribe to FOCUS_FILE events
    this.unsubscribeFocusFile = bus.subscribe<FocusFileEvent>(
      EVENT_TYPES.FOCUS_FILE,
      (event) => {
        void this.loadAndDisplayFile(event.path, event.lineNumber, event.triggerSource);
      },
    );

    // Start in preview mode. The editor stays visible (keeps vim focus/events)
    // and the preview + hint overlay it.
    this._inNormalMode = true;
    this.view.focus();
    if (this._previewEl) this._previewEl.style.display = 'block';
    if (this._hintEl) this._hintEl.style.display = 'flex';

    // Load default file
    void this.loadAndDisplayFile('index.md');
  }

  /**
   * Load a file by path and update the editor content with a flash transition.
   */
  async loadAndDisplayFile(path: string, lineNumber?: number, triggerSource?: string): Promise<void> {
    if (!this.view || !this.statusBar) return;

    this.statusBar.setLoading(true);

    // Flash only for agent- or CLI-driven navigation, not explorer clicks or
    // the initial load, and not when returning from preview (triggerSource: 'preview').
    const isInitialLoad = this._currentFile === 'index.md' && path === 'index.md';
    if (!isInitialLoad && (triggerSource === 'agent' || triggerSource === 'cli')) {
      // Flash whichever surface is visible: the preview overlay when in normal
      // mode, or the editor wrap itself when in insert/edit mode.
      const flashEl = (this._inNormalMode && this._previewEl)
        ? this._previewEl
        : this._editorEl?.closest<HTMLElement>('#vim-editor-wrap');
      if (flashEl) {
        flashEl.classList.remove('page-flash');
        void flashEl.offsetWidth;
        flashEl.classList.add('page-flash');
      }
    }

    // Also briefly dim the CodeMirror node while content loads.
    const editorEl = this.view.dom;
    editorEl.style.transition = 'opacity 0.12s ease';
    editorEl.style.opacity = '0.3';

    try {
      const content = await loadFile(path);
      this._currentFile = path;
      this.statusBar.setFile(path);
      this._renderPreview(content);

      // Replace content
      this.view.dispatch({
        changes: {
          from: 0,
          to: this.view.state.doc.length,
          insert: content,
        },
        // Scroll to top (or specified line)
        selection: lineNumber
          ? { anchor: this.getOffsetForLine(lineNumber) }
          : { anchor: 0 },
      });

      if (lineNumber) {
        this.view.dispatch({
          effects: EditorView.scrollIntoView(
            this.getOffsetForLine(lineNumber),
            { y: 'center' },
          ),
        });
      } else {
        // Scroll to top
        this.view.dispatch({
          effects: EditorView.scrollIntoView(0),
        });
      }
    } catch (err) {
      console.error('[VimEditor] Failed to load file:', path, err);
      // Show error inline
      this.view.dispatch({
        changes: {
          from: 0,
          to: this.view.state.doc.length,
          insert: `# Error loading file\n\nCould not load: \`${path}\`\n\n${String(err)}`,
        },
        selection: { anchor: 0 },
      });
    } finally {
      this.statusBar.setLoading(false);
      editorEl.style.transition = 'opacity 0.18s ease';
      editorEl.style.opacity = '1';
    }
  }

  /** Returns the current file path. */
  getCurrentFile(): string {
    return this._currentFile;
  }

  /** Returns the editor's current state. */
  getState(): EditorState {
    if (!this.view) throw new Error('VimEditor not yet created');
    return this.view.state;
  }

  /** Always returns true — this editor is always read-only. */
  isReadOnly(): boolean {
    return true;
  }

  /** Destroy the editor and clean up subscriptions. */
  destroy(): void {
    this.unsubscribeFocusFile?.();
    this.view?.destroy();
    this.view = null;
  }

  // ─── Preview / mode swap ────────────────────────────────────────────────────

  private _setMode(normal: boolean): void {
    if (this._inNormalMode === normal) return;
    this._inNormalMode = normal;

    if (!this._previewEl) return;

    if (normal) {
      this._syncPreviewScroll(this._getEditorScrollPct());
      this._previewEl.style.display = 'block';
      if (this._hintEl) this._hintEl.style.display = 'flex';
    } else {
      const pct = this._previewEl.scrollTop /
        (this._previewEl.scrollHeight - this._previewEl.clientHeight || 1);
      this._previewEl.style.display = 'none';
      if (this._hintEl) this._hintEl.style.display = 'none';
      this._syncEditorScroll(pct);
      this.view?.focus();
    }
  }

  private _getEditorScrollPct(): number {
    if (!this.view) return 0;
    const scroller = this.view.scrollDOM;
    return scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);
  }

  private _syncPreviewScroll(pct: number): void {
    if (!this._previewEl) return;
    requestAnimationFrame(() => {
      const el = this._previewEl!;
      el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
    });
  }

  private _syncEditorScroll(pct: number): void {
    if (!this.view) return;
    requestAnimationFrame(() => {
      const scroller = this.view!.scrollDOM;
      scroller.scrollTop = pct * (scroller.scrollHeight - scroller.clientHeight);
    });
  }

  private _renderPreview(content: string): void {
    if (!this._previewEl) return;
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const html = marked.parse(stripped) as string;
    this._previewEl.innerHTML = html;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private getOffsetForLine(lineNumber: number): number {
    if (!this.view) return 0;
    const doc = this.view.state.doc;
    const clampedLine = Math.min(Math.max(1, lineNumber), doc.lines);
    return doc.line(clampedLine).from;
  }

  private patchVimCommands(): void {
    const noop = () => {};
    const returnToPreview = () => { this._forceNormalMode(); };
    try {
      Vim.defineEx('write', 'w', noop);           // :w   — no-op (nothing to save)
      Vim.defineEx('wq', 'wq', returnToPreview);  // :wq  — return to preview
      Vim.defineEx('wqall', 'wqa', returnToPreview);
      Vim.defineEx('x', 'x', returnToPreview);    // :x   — return to preview
      Vim.defineEx('xit', 'xi', returnToPreview);
      Vim.defineEx('quit', 'q', returnToPreview); // :q   — return to preview
      Vim.defineEx('qall', 'qa', returnToPreview);// :qa  — return to preview
    } catch (err) {
      console.warn('[VimEditor] Could not patch vim ex-commands:', err);
    }
  }

  private _forceNormalMode(): void {
    // Ensure vim state is in normal mode, then show preview
    if (this.view) {
      const cm = getCM(this.view);
      if (cm) Vim.handleKey(cm, '<Esc>', 'mapping');
    }
    // _setMode guards against no-op if already normal, so bypass the guard
    this._inNormalMode = false;
    this._setMode(true);
  }
}

// ─── Panel init function ──────────────────────────────────────────────────────

/**
 * Top-level initialization for the Vim editor panel.
 * Called by src/panels/vim-panel.ts.
 */
export function initVimEditor(
  editorElement: HTMLElement,
  statusBarElement: HTMLElement,
): VimEditor {
  const editor = new VimEditor();
  editor.create(editorElement, statusBarElement);
  return editor;
}

/**
 * Load a specific file into the already-initialized editor.
 * Convenience wrapper for callers that don't hold a VimEditor reference.
 */
export async function loadFileIntoEditor(
  editor: VimEditor,
  path: string,
): Promise<void> {
  return editor.loadAndDisplayFile(path);
}

/**
 * Load the default file (www/index.md) via fileLoader.
 */
export async function loadDefaultContent(editor: VimEditor): Promise<void> {
  const content = await getDefaultFile();
  if (!editor.isReadOnly()) return; // Always read-only; this is just a guard
  // getDefaultFile returns content; we need to trigger loadAndDisplayFile
  await editor.loadAndDisplayFile('index.md');
  void content; // content was fetched as a side-effect by loadAndDisplayFile
}
