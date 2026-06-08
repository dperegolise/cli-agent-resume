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
import { vim, Vim } from '@replit/codemirror-vim';
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
    '.cm-vim-panel':        { display: 'none' },
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

export class VimEditor {
  private view: EditorView | null = null;
  private statusBar: PowerlineBar | null = null;
  private _currentFile: string = 'index.md';
  private unsubscribeFocusFile: (() => void) | null = null;

  /**
   * Create and mount the editor into `element`.
   * `statusBarElement` receives the PowerlineBar DOM.
   */
  create(element: HTMLElement, statusBarElement: HTMLElement): void {
    this.statusBar = new PowerlineBar(statusBarElement);

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

    // Subscribe to FOCUS_FILE events
    this.unsubscribeFocusFile = bus.subscribe<FocusFileEvent>(
      EVENT_TYPES.FOCUS_FILE,
      (event) => {
        void this.loadAndDisplayFile(event.path, event.lineNumber);
      },
    );

    // Load default file
    void this.loadAndDisplayFile('index.md');
  }

  /**
   * Load a file by path and update the editor content with a fade transition.
   */
  async loadAndDisplayFile(path: string, lineNumber?: number): Promise<void> {
    if (!this.view || !this.statusBar) return;

    this.statusBar.setLoading(true);

    // Apply fade-out class via DOM
    const editorEl = this.view.dom;
    editorEl.style.transition = 'opacity 0.15s ease';
    editorEl.style.opacity = '0.4';

    try {
      const content = await loadFile(path);
      this._currentFile = path;
      this.statusBar.setFile(path);

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

  // ─── Private helpers ────────────────────────────────────────────────────────

  private getOffsetForLine(lineNumber: number): number {
    if (!this.view) return 0;
    const doc = this.view.state.doc;
    const clampedLine = Math.min(Math.max(1, lineNumber), doc.lines);
    return doc.line(clampedLine).from;
  }

  private patchVimCommands(): void {
    const noop = () => { /* no-op: content is local-only, nothing to write */ };
    try {
      // :w / :wq / :x — silently no-op; edits stay local, never sent to server
      Vim.defineEx('write', 'w', noop);
      Vim.defineEx('wq', '', noop);
      Vim.defineEx('x', '', noop);
      Vim.defineEx('xit', '', noop);
    } catch (err) {
      console.warn('[VimEditor] Could not patch vim ex-commands:', err);
    }
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
