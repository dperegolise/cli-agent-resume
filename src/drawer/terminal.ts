/**
 * src/drawer/terminal.ts — CLITerminal: mocked shell over portfolio files.
 * All commands operate against the cached manifest in the browser.
 * Nothing is sent to a server except the existing /agent SSE endpoint.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { toXtermTheme, ThemeManager } from '../theme.js';
import { bus, EVENT_TYPES } from '../bus.js';
import { dispatch, type CommandContext } from './commands.js';
import { tabComplete, resetCompletion } from './completion.js';
import { pushHistory, historyUp, historyDown, resetCursor } from './history.js';
import type { ThemeChangeEvent } from '../types.js';

// ─── Splash ───────────────────────────────────────────────────────────────────

const Y = '\x1b[93m';
const G = '\x1b[92m';
const C = '\x1b[96m';
const R = '\x1b[0m';

const D = '\x1b[2m';  // dim

const SPLASH_LINES = [
  '',
  `  ${Y}PORTFOLIO${R} ${C}///${R} ${G}Daniel Peregolise${R}`,
  `  ${C}${'─'.repeat(38)}${R}`,
  `  Type ${G}'help'${R} for available commands.`,
  `  ${D}~ try: ls · search rust · cat about.md | grep -i skills${R}`,
  '',
];

const PROMPT = `  \x1b[92mvisitor@portfolio\x1b[0m:\x1b[94m~\x1b[0m$ `;

// ─── CLITerminal ──────────────────────────────────────────────────────────────

export class CLITerminal {
  private term: Terminal;
  private fitAddon: FitAddon;
  private lineBuffer = '';
  private cursorPos = 0; // index into lineBuffer where the cursor sits
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeTheme: (() => void) | null = null;

  constructor(private readonly themeManager: ThemeManager) {
    const theme = themeManager.getTheme();
    this.fitAddon = new FitAddon();
    this.term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Symbols Nerd Font', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 1000,
      theme: toXtermTheme(theme),
    });
    this.term.loadAddon(this.fitAddon);
    this.term.onSelectionChange(() => {
      const sel = this.term.getSelection();
      if (sel) void navigator.clipboard.writeText(sel);
    });
  }

  mount(element: HTMLElement): void {
    this.term.open(element);
    try { this.fitAddon.fit(); } catch { /* ignore */ }

    this.resizeObserver = new ResizeObserver(() => {
      try { this.fitAddon.fit(); } catch { /* ignore */ }
    });
    this.resizeObserver.observe(element);
    window.addEventListener('resize', this._onWindowResize);

    for (const line of SPLASH_LINES) this.term.writeln(line);
    this.showPrompt();
    this.term.scrollToBottom();
    this.attachInput();
    this.subscribeTheme();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this._onWindowResize);
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.term.dispose();
  }

  // ─── Input ────────────────────────────────────────────────────────────────────

  private attachInput(): void {
    this.term.onData((data) => { void this.handleData(data); });
  }

  private async handleData(data: string): Promise<void> {
    // Ctrl-C
    if (data === '\x03') {
      this.term.write('^C');
      this.lineBuffer = '';
      this.cursorPos = 0;
      resetCompletion();
      resetCursor('');
      this.term.writeln('');
      this.showPrompt();
      return;
    }

    // Backspace — delete char before cursor
    if (data === '\x7f' || data === '\b') {
      if (this.cursorPos > 0) {
        this.lineBuffer =
          this.lineBuffer.slice(0, this.cursorPos - 1) +
          this.lineBuffer.slice(this.cursorPos);
        this.cursorPos--;
        this.redrawLine();
        resetCompletion();
      }
      return;
    }

    // Delete key — delete char after cursor
    if (data === '\x1b[3~') {
      if (this.cursorPos < this.lineBuffer.length) {
        this.lineBuffer =
          this.lineBuffer.slice(0, this.cursorPos) +
          this.lineBuffer.slice(this.cursorPos + 1);
        this.redrawLine();
        resetCompletion();
      }
      return;
    }

    // Enter
    if (data === '\r' || data === '\n') {
      const input = this.lineBuffer;
      this.lineBuffer = '';
      this.cursorPos = 0;
      resetCompletion();
      resetCursor('');
      this.term.writeln('');
      if (input.trim()) {
        pushHistory(input);
        await this.executeCommand(input);
      }
      this.term.writeln('');
      this.showPrompt();
      return;
    }

    // Tab completion
    if (data === '\t') {
      const result = tabComplete(this.lineBuffer);
      switch (result.type) {
        case 'single':
        case 'cycle':
          this.lineBuffer = result.completed;
          this.cursorPos = this.lineBuffer.length;
          this.clearLine();
          this.term.write(this.lineBuffer);
          break;
        case 'multiple':
          this.term.writeln('');
          this.term.writeln(result.matches.join('  '));
          this.showPrompt();
          this.term.write(this.lineBuffer);
          break;
        case 'none':
          this.term.write('\x07');
          break;
      }
      return;
    }

    // Arrow up — history prev
    if (data === '\x1b[A') {
      const prev = historyUp(this.lineBuffer);
      if (prev !== null) {
        this.lineBuffer = prev;
        this.cursorPos = prev.length;
        this.clearLine();
        this.term.write(prev);
      }
      return;
    }
    // Arrow down — history next
    if (data === '\x1b[B') {
      const next = historyDown();
      if (next !== null) {
        this.lineBuffer = next;
        this.cursorPos = next.length;
        this.clearLine();
        this.term.write(next);
      }
      return;
    }
    // Arrow left — move cursor back
    if (data === '\x1b[D') {
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.term.write('\x1b[D');
      }
      return;
    }
    // Arrow right — move cursor forward
    if (data === '\x1b[C') {
      if (this.cursorPos < this.lineBuffer.length) {
        this.cursorPos++;
        this.term.write('\x1b[C');
      }
      return;
    }
    // Home / Ctrl-A — jump to start
    if (data === '\x1b[H' || data === '\x01') {
      if (this.cursorPos > 0) {
        this.term.write(`\x1b[${this.cursorPos}D`);
        this.cursorPos = 0;
      }
      return;
    }
    // End / Ctrl-E — jump to end
    if (data === '\x1b[F' || data === '\x05') {
      const remaining = this.lineBuffer.length - this.cursorPos;
      if (remaining > 0) {
        this.term.write(`\x1b[${remaining}C`);
        this.cursorPos = this.lineBuffer.length;
      }
      return;
    }

    // Ignore other escape sequences
    if (data.startsWith('\x1b')) return;

    // Printable character — insert at cursor position
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      resetCompletion();
      this.lineBuffer =
        this.lineBuffer.slice(0, this.cursorPos) +
        data +
        this.lineBuffer.slice(this.cursorPos);
      this.cursorPos++;
      this.redrawLine();
    }
  }

  /** Redraw the line in-place and reposition the terminal cursor. */
  private redrawLine(): void {
    const charsFromEnd = this.lineBuffer.length - this.cursorPos;
    // Move to start of input, overwrite with updated buffer, clear any leftover
    // chars, then move cursor back to its logical position.
    this.term.write(
      '\r\x1b[K' +           // CR + erase to end of line
      PROMPT +               // re-draw prompt
      this.lineBuffer +      // re-draw buffer
      (charsFromEnd > 0 ? `\x1b[${charsFromEnd}D` : ''), // reposition
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private showPrompt(): void {
    this.term.write(PROMPT);
  }

  private clearLine(): void {
    // Move cursor back to end then erase — simpler than tracking from cursorPos
    const charsFromEnd = this.lineBuffer.length - this.cursorPos;
    if (charsFromEnd > 0) this.term.write(`\x1b[${charsFromEnd}C`);
    const len = this.lineBuffer.length;
    if (len > 0) this.term.write('\b'.repeat(len) + ' '.repeat(len) + '\b'.repeat(len));
    this.cursorPos = 0;
  }

  private readonly _onWindowResize = (): void => {
    try { this.fitAddon.fit(); } catch { /* ignore */ }
  };

  private subscribeTheme(): void {
    this.unsubscribeTheme = bus.subscribe<ThemeChangeEvent>(EVENT_TYPES.THEME_CHANGE, () => {
      try { this.term.options.theme = toXtermTheme(this.themeManager.getTheme()); } catch { /* ignore */ }
    });
  }

  private async executeCommand(input: string): Promise<void> {
    const ctx: CommandContext = {
      write: (line) => this.term.writeln(line),
      clearScreen: () => this.term.clear(),
      setTheme: (name) => {
        this.themeManager.setTheme(name);
        this.term.options.theme = toXtermTheme(this.themeManager.getTheme());
      },
    };
    try {
      await dispatch(input, ctx);
    } catch (err) {
      this.term.writeln(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
    }
  }
}
