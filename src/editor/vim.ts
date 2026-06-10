/**
 * src/editor/vim.ts — CodeMirror 6 + Vim keybindings, read-only Markdown viewer
 * Owned by milestone m4-vim-panel.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, lineNumbers } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { marked } from 'marked';
import { bus, EVENT_TYPES } from '../bus.js';
import { clickableLinks } from './clickableLinks.js';
import { loadFile, getDefaultFile } from './fileLoader.js';
import { PowerlineBar, powerlineBarExtension } from './statusBar.js';
import { DEFAULT } from '../theme.js';
import type { FocusFileEvent } from '../types.js';

// ─── Default theme syntax highlight style ────────────────────────────────────
// Restrained palette (restyle/portfolio-style-guide.md): hierarchy comes from
// brightness, hue is reserved for semantics, and everything stays low-chroma.

const defaultHighlight = HighlightStyle.define([
  // Headings: desaturated vim-colorscheme hues — ochre h1, sage below
  { tag: t.heading1,       color: '#bcab76', fontWeight: 'bold' },
  { tag: t.heading2,       color: '#8fae98', fontWeight: 'bold' },
  { tag: t.heading3,       color: '#8fae98', fontWeight: 'bold' },
  { tag: t.heading,        color: '#8fae98', fontWeight: 'bold' },
  // Strong: brighter off-white; emphasis: muted mauve italic
  { tag: t.strong,         color: '#e2e2dc', fontWeight: 'bold' },
  { tag: t.emphasis,       color: '#b3a0ba', fontStyle: 'italic' },
  // Links: the one quiet accent (desaturated steel)
  { tag: t.link,           color: '#9aa5b1', textDecoration: 'underline' },
  { tag: t.url,            color: '#9aa5b1' },
  // Inline code: muted sage
  { tag: t.monospace,      color: '#7c9885', fontFamily: "'JetBrains Mono', monospace" },
  { tag: t.contentSeparator, color: '#6b6b6b' },
  // Quotes / comments — secondary gray
  { tag: t.comment,        color: '#6b6b6b', fontStyle: 'italic' },
  { tag: t.blockComment,   color: '#6b6b6b', fontStyle: 'italic' },
  // List bullets get a dry ochre; other syntax markers (#, **, >) recede
  { tag: t.list,           color: '#a89868' },
  { tag: t.punctuation,    color: '#6b6b6b' },
  { tag: t.processingInstruction, color: '#6b6b6b' },
  // Strings / atoms — muted sage / mauve
  { tag: t.string,         color: '#7c9885' },
  { tag: t.atom,           color: '#a08ca8' },
  // Keywords / operators (for embedded code blocks) — all desaturated
  { tag: t.keyword,        color: '#b05656' },
  { tag: t.operator,       color: '#9aa5b1' },
  { tag: t.number,         color: '#a08ca8' },
  { tag: t.bool,           color: '#a08ca8' },
  { tag: t.variableName,   color: '#8ba3c4' },
  { tag: t.function(t.variableName), color: '#7c9885' },
  { tag: t.typeName,       color: '#a89868' },
  { tag: t.className,      color: '#a89868' },
  { tag: t.propertyName,   color: '#8ba3c4' },
  { tag: t.tagName,        color: '#b05656' },
  { tag: t.attributeName,  color: '#a89868' },
  { tag: t.attributeValue, color: '#7c9885' },
]);

// ─── Default theme CodeMirror theme ──────────────────────────────────────────

const defaultTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: DEFAULT.colors.bg,
      color: DEFAULT.colors.fg,
      fontFamily: "'JetBrains Mono', 'Symbols Nerd Font', monospace",
      fontSize: '12px',
    },
    '.cm-content': {
      caretColor: DEFAULT.colors.cursor,
      padding: '8px 10px',
    },
    '.cm-cursor': {
      borderLeftColor: DEFAULT.colors.cursor,
      borderLeftWidth: '2px',
    },
    // Gutter recedes hard: same bg as the buffer, near-invisible numbers
    '.cm-gutters': {
      backgroundColor: DEFAULT.colors.bg,
      color: '#3a3a3c',
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: DEFAULT.colors.ansi[8] },
    '.cm-activeLine':       { backgroundColor: DEFAULT.colors.ansi[0] },
    // Same affordance as preview links: resting underline in the faint
    // accent-edge, brightening to the full accent on hover.
    '.cm-clickable-link': {
      cursor: 'pointer',
      textDecoration: 'underline',
      textDecorationColor: '#3a4048',
      textUnderlineOffset: '2px',
    },
    '.cm-clickable-link:hover': {
      textDecorationColor: '#9aa5b1',
    },
    '.cm-scroller':         { overflow: 'auto' },
    '.cm-vim-panel':        { background: DEFAULT.colors.bg, color: DEFAULT.colors.fg, padding: '0 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', minHeight: '1.4em', borderTop: `1px solid ${DEFAULT.colors.selection}` },
    '.cm-vim-panel input':  { background: 'transparent', color: DEFAULT.colors.fg, fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', outline: 'none', border: 'none', width: '100%' },
  },
  { dark: true },
);

// Inject selection highlight as a real stylesheet so it beats the vim plugin's
// `background-color: transparent !important` on ::selection. EditorView.theme()
// loses that specificity war; a <style> tag added to <head> wins it.
(function injectSelectionStyle() {
  if (document.getElementById('cm-selection-style')) return;
  const s = document.createElement('style');
  s.id = 'cm-selection-style';
  s.textContent = `.cm-selectionBackground { background-color: ${DEFAULT.colors.selection} !important; }
.cm-focused .cm-selectionBackground { background-color: ${DEFAULT.colors.selection} !important; }`;
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
      // Editor gutter — near-invisible line numbers, like a real buffer
      lineNumbers(),
      // Markdown language support + embedded language highlighting
      markdown(),
      // Restrained-terminal color theme
      defaultTheme,
      // Syntax highlighting (must come after the language extension)
      syntaxHighlighting(defaultHighlight),
      // Detected URLs / emails / portfolio paths are clickable in the source
      clickableLinks,
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
      if (!href) return;
      // Any scheme'd URI (http, https, mailto, …) is external — only bare
      // relative paths are internal portfolio navigation.
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        if (href.startsWith('mailto:')) {
          window.location.href = href;
        } else {
          window.open(href, '_blank', 'noopener');
        }
        return;
      }
      // Internal link — resolve relative paths against the current file's directory
      let path = href.replace(/^\//, '');
      if (!path.startsWith('http') && !path.includes(':') && !path.startsWith('/')) {
        // Relative path: resolve against current file's directory
        const dir = this._currentFile.includes('/')
          ? this._currentFile.slice(0, this._currentFile.lastIndexOf('/') + 1)
          : '';
        path = dir + path;
        // Collapse any ../ segments
        const parts = path.split('/');
        const resolved: string[] = [];
        for (const p of parts) {
          if (p === '..') resolved.pop();
          else if (p !== '.') resolved.push(p);
        }
        path = resolved.join('/');
      }
      bus.emit(EVENT_TYPES.FOCUS_FILE, { path, triggerSource: 'preview' });
    });

    // Subscribe to FOCUS_FILE events
    this.unsubscribeFocusFile = bus.subscribe<FocusFileEvent>(
      EVENT_TYPES.FOCUS_FILE,
      (event) => {
        void this.loadAndDisplayFile(event.path, event.lineNumber, event.triggerSource);
      },
    );

    // Wire the powerline [preview]/[source] toggle
    this.statusBar.onToggleView = () => this.toggleView();

    // Start in source (vim) mode showing raw markdown. The rendered preview
    // is opt-in: powerline toggle, :preview, or :q.
    // Don't steal focus here — the agent terminal owns the initial cursor;
    // clicking into the buffer focuses CodeMirror naturally.
    this._inNormalMode = false;
    this.statusBar.setSurface('source');
    if (this._previewEl) this._previewEl.style.display = 'none';
    if (this._hintEl) this._hintEl.style.display = 'none';

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

  /** Toggle between the raw-markdown source view and the rendered preview. */
  toggleView(): void {
    if (this._inNormalMode) {
      this._setMode(false);
    } else {
      this._forceNormalMode();
    }
  }

  private _setMode(normal: boolean): void {
    if (this._inNormalMode === normal) return;
    this._inNormalMode = normal;
    this.statusBar?.setSurface(normal ? 'preview' : 'source');

    if (!this._previewEl) return;

    if (normal) {
      // Re-render from the live editor content so edits are reflected immediately
      if (this.view) this._renderPreview(this.view.state.doc.toString());
      this._syncPreviewScroll(this._getEditorScrollPct());
      this._previewEl.style.display = 'block';
      if (this._hintEl) this._hintEl.style.display = 'flex';
      // Focus the preview so its keydown forwarder still catches insert keys
      // (e.g. after the powerline toggle stole focus from the editor)
      this._previewEl.focus({ preventScroll: true });
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
      Vim.defineEx('preview', 'pre', returnToPreview); // :preview — rendered view
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
