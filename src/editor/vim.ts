/**
 * src/editor/vim.ts — CodeMirror 6 + Vim keybindings, read-only Markdown viewer
 * Owned by milestone m4-vim-panel.
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { vim, Vim } from '@replit/codemirror-vim';
import { bus, EVENT_TYPES } from '../bus.js';
import { loadFile, getDefaultFile } from './fileLoader.js';
import { PowerlineBar, powerlineBarExtension } from './statusBar.js';
import { GRUVBOX_DARK } from '../theme.js';
import type { FocusFileEvent } from '../types.js';

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
    '.cm-selectionBackground': {
      backgroundColor: GRUVBOX_DARK.colors.selection,
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: GRUVBOX_DARK.colors.selection,
    },
    '.cm-gutters': {
      backgroundColor: '#282828',
      color: '#928374',
      borderRight: '1px solid #504945',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#3c3836',
    },
    '.cm-activeLine': {
      backgroundColor: '#3c3836',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    // Markdown syntax colors (Gruvbox)
    '.cm-header': { color: '#fb4934', fontWeight: 'bold' },
    '.cm-header-1': { color: '#fb4934' },
    '.cm-header-2': { color: '#fabd2f' },
    '.cm-header-3': { color: '#b8bb26' },
    '.cm-strong': { color: '#ebdbb2', fontWeight: 'bold' },
    '.cm-em': { color: '#d3869b', fontStyle: 'italic' },
    '.cm-link': { color: '#83a598' },
    '.cm-url': { color: '#8ec07c' },
    '.cm-quote': { color: '#928374' },
    '.cm-monospace': { color: '#8ec07c', fontFamily: "'JetBrains Mono', monospace" },
    // vim status line area
    '.cm-vim-panel': { display: 'none' },  // hide default vim panel; we use our own
  },
  { dark: true },
);

// ─── Read-only toast ──────────────────────────────────────────────────────────

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showReadOnlyToast(): void {
  let toast = document.getElementById('vim-readonly-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'vim-readonly-toast';
    toast.style.cssText = [
      'position: fixed',
      'bottom: 40px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: #504945',
      'color: #ebdbb2',
      'padding: 4px 12px',
      'border-radius: 4px',
      'font-family: JetBrains Mono, monospace',
      'font-size: 12px',
      'z-index: 9999',
      'pointer-events: none',
      'border: 1px solid #d65d0e',
      'transition: opacity 0.2s',
    ].join(';');
    toast.textContent = 'E45: \'readonly\' option is set (add ! to override)';
    document.body.appendChild(toast);
  }
  toast.style.opacity = '1';
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (toast) toast.style.opacity = '0';
  }, 2000);
}

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
      // Vim keybindings (no default status bar — we have our own)
      vim({ status: false }),
      // Markdown language support
      markdown(),
      // Gruvbox color theme
      gruvboxTheme,
      // Read-only
      EditorState.readOnly.of(true),
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
    if (!this.view) return;

    // Override Vim ex commands that would mutate state
    const noop = () => { /* read-only, no-op */ };
    const readOnlyFlash = () => { showReadOnlyToast(); };

    try {
      // :w, :wq, :x — write commands
      Vim.defineEx('write', 'w', noop);
      Vim.defineEx('wq', '', noop);
      Vim.defineEx('x', '', noop);
      Vim.defineEx('xit', '', noop);

      // Override insert-mode entry keys to flash "read-only"
      // We map them through the Vim command system
      Vim.map('i', '<Nop>', 'normal');
      Vim.map('I', '<Nop>', 'normal');
      Vim.map('a', '<Nop>', 'normal');
      Vim.map('A', '<Nop>', 'normal');
      Vim.map('o', '<Nop>', 'normal');
      Vim.map('O', '<Nop>', 'normal');
      Vim.map('s', '<Nop>', 'normal');
      Vim.map('S', '<Nop>', 'normal');
      Vim.map('c', '<Nop>', 'normal');
      Vim.map('C', '<Nop>', 'normal');
      Vim.map('r', '<Nop>', 'normal');
      Vim.map('R', '<Nop>', 'normal');
      Vim.map('p', '<Nop>', 'normal');
      Vim.map('P', '<Nop>', 'normal');
      Vim.map('d', '<Nop>', 'normal');
      Vim.map('D', '<Nop>', 'normal');
      Vim.map('x', '<Nop>', 'normal');
      Vim.map('X', '<Nop>', 'normal');
    } catch (err) {
      // Non-fatal — some Vim versions may not support all overrides
      console.warn('[VimEditor] Could not patch all vim commands:', err);
    }

    // Additionally, intercept keydown events to show toast for edit attempts
    const editKeys = new Set(['i', 'I', 'a', 'A', 'o', 'O', 's', 'S', 'c', 'C', 'r', 'R']);
    this.view!.dom.addEventListener('keydown', (e: KeyboardEvent) => {
      if (editKeys.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        showReadOnlyToast();
        // Don't prevent default — the <Nop> mapping handles the actual key
      }
    }, { capture: false });

    void readOnlyFlash; // referenced to avoid unused warning
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
