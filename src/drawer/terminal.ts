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

const SPLASH_LINES = [
  '',
  `  ${Y}PORTFOLIO${R} ${C}///${R} ${G}Daniel Peregolise${R}`,
  `  ${C}${'─'.repeat(38)}${R}`,
  `  Type ${G}'help'${R} for available commands.`,
  '',
];

const PROMPT = `\x1b[92mvisitor@portfolio\x1b[0m:\x1b[94m~\x1b[0m$ `;

// ─── CLITerminal ──────────────────────────────────────────────────────────────

export class CLITerminal {
  private term: Terminal;
  private fitAddon: FitAddon;
  private lineBuffer = '';
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeTheme: (() => void) | null = null;

  constructor(private readonly themeManager: ThemeManager) {
    const theme = themeManager.getTheme();
    this.fitAddon = new FitAddon();
    this.term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Symbols Nerd Font', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 1000,
      theme: toXtermTheme(theme),
    });
    this.term.loadAddon(this.fitAddon);
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
    if (data === '\x03') {
      this.term.write('^C');
      this.lineBuffer = '';
      resetCompletion();
      resetCursor('');
      this.term.writeln('');
      this.showPrompt();
      return;
    }

    if (data === '\x7f' || data === '\b') {
      if (this.lineBuffer.length > 0) {
        this.lineBuffer = this.lineBuffer.slice(0, -1);
        this.term.write('\b \b');
        resetCompletion();
      }
      return;
    }

    if (data === '\r' || data === '\n') {
      const input = this.lineBuffer;
      this.lineBuffer = '';
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

    if (data === '\t') {
      const result = tabComplete(this.lineBuffer);
      switch (result.type) {
        case 'single':
        case 'cycle':
          this.clearLine();
          this.lineBuffer = result.completed;
          this.term.write(result.completed);
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

    if (data === '\x1b[A') {
      const prev = historyUp(this.lineBuffer);
      if (prev !== null) { this.clearLine(); this.lineBuffer = prev; this.term.write(prev); }
      return;
    }
    if (data === '\x1b[B') {
      const next = historyDown();
      if (next !== null) { this.clearLine(); this.lineBuffer = next; this.term.write(next); }
      return;
    }
    if (data.startsWith('\x1b')) return;

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      resetCompletion();
      this.lineBuffer += data;
      this.term.write(data);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private showPrompt(): void {
    this.term.write(PROMPT);
  }

  private clearLine(): void {
    const len = this.lineBuffer.length;
    if (len === 0) return;
    this.term.write('\b'.repeat(len) + ' '.repeat(len) + '\b'.repeat(len));
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
