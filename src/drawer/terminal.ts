/**
 * src/drawer/terminal.ts — CLITerminal class
 * Bottom xterm.js drawer with command interpreter, tab completion, and history.
 *
 * Responsibilities:
 *  - Mount xterm.js into #cli-drawer
 *  - Print splash screen + initial prompt on mount
 *  - Handle keyboard input (printable chars, backspace, Enter, Tab, arrows, Ctrl+C)
 *  - Subscribe to THEME_CHANGE events → update terminal theme
 *  - Delegate command execution to commands.ts
 *  - Delegate Tab completion to completion.ts
 *  - Delegate history navigation to history.ts
 *
 * NOTE: Does NOT bind to #drawer-toggle — m2's responsive.ts owns that.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { toXtermTheme, ThemeManager } from '../theme.js';
import { bus, EVENT_TYPES } from '../bus.js';
import { dispatch, type CommandContext } from './commands.js';
import { tabComplete, resetCompletion } from './completion.js';
import {
  pushHistory,
  historyUp,
  historyDown,
  resetCursor,
} from './history.js';
import type { ThemeChangeEvent } from '../types.js';

// ─── Splash screen ────────────────────────────────────────────────────────────

// Gruvbox bright-yellow ANSI escape for the ASCII art banner
const Y = '\x1b[93m'; // bright yellow
const G = '\x1b[92m'; // bright green
const C = '\x1b[96m'; // bright cyan
const R = '\x1b[0m';  // reset

const SPLASH_LINES = [
  '',
  `${Y}██████╗  ██████╗ ██████╗ ████████╗███████╗ ██████╗ ██╗     ██╗ ██████╗${R}`,
  `${Y}██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝██╔═══██╗██║     ██║██╔═══██╗${R}`,
  `${Y}██████╔╝██║   ██║██████╔╝   ██║   █████╗  ██║   ██║██║     ██║██║   ██║${R}`,
  `${Y}██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔══╝  ██║   ██║██║     ██║██║   ██║${R}`,
  `${Y}██║     ╚██████╔╝██║  ██║   ██║   ██║     ╚██████╔╝███████╗██║╚██████╔╝${R}`,
  `${Y}╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝      ╚═════╝ ╚══════╝╚═╝ ╚═════╝${R}`,
  '',
  `  ${G}Daniel Peregolise's portfolio${R} ${C}— v1.0.0${R}`,
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

    this.term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 1000,
      theme: toXtermTheme(theme),
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
  }

  // ─── Mount ──────────────────────────────────────────────────────────────────

  /**
   * Mount the terminal into the given DOM element.
   * Prints splash screen and shows the initial prompt.
   */
  mount(element: HTMLElement): void {
    this.term.open(element);
    this.fitAddon.fit();

    // Watch element size changes
    this.resizeObserver = new ResizeObserver(() => {
      try {
        this.fitAddon.fit();
      } catch {
        // Ignore fit errors when element is hidden
      }
    });
    this.resizeObserver.observe(element);

    // Subscribe to window resize as well
    window.addEventListener('resize', this._onWindowResize);

    // Print splash
    for (const line of SPLASH_LINES) {
      this.term.writeln(line);
    }

    this.showPrompt();
    this.attachInput();
    this.subscribeTheme();
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this._onWindowResize);
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.term.dispose();
  }

  // ─── Theme ───────────────────────────────────────────────────────────────────

  private subscribeTheme(): void {
    this.unsubscribeTheme = bus.subscribe<ThemeChangeEvent>(
      EVENT_TYPES.THEME_CHANGE,
      (evt) => {
        // The ThemeManager already updated its internal state; get the new theme
        try {
          const newTheme = this.themeManager.getTheme();
          this.term.options.theme = toXtermTheme(newTheme);
        } catch {
          // Safety: ignore if theme name unknown
        }
        // If the event carries the name, try to force-update
        if (evt.themeName) {
          try {
            this.themeManager.setTheme(evt.themeName);
            this.term.options.theme = toXtermTheme(this.themeManager.getTheme());
          } catch {
            // ignore
          }
        }
      },
    );
  }

  // ─── Input handling ───────────────────────────────────────────────────────────

  private attachInput(): void {
    this.term.onData((data) => {
      void this.handleData(data);
    });
  }

  private async handleData(data: string): Promise<void> {
    // ── Ctrl+C ──
    if (data === '\x03') {
      this.term.write('^C');
      this.lineBuffer = '';
      resetCompletion();
      resetCursor('');
      this.term.writeln('');
      this.showPrompt();
      return;
    }

    // ── Backspace ──
    if (data === '\x7f' || data === '\b') {
      if (this.lineBuffer.length > 0) {
        this.lineBuffer = this.lineBuffer.slice(0, -1);
        // Move cursor back, overwrite with space, move back again
        this.term.write('\b \b');
        resetCompletion();
      }
      return;
    }

    // ── Enter ──
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

      this.showPrompt();
      return;
    }

    // ── Tab ──
    if (data === '\t') {
      const result = tabComplete(this.lineBuffer);
      switch (result.type) {
        case 'single':
        case 'cycle': {
          const completed = result.completed;
          // Rewrite the current line
          this.clearLine();
          this.lineBuffer = completed;
          this.term.write(completed);
          break;
        }
        case 'multiple': {
          // Print matches on a new line, then restore partial input
          this.term.writeln('');
          this.term.writeln(result.matches.join('  '));
          this.showPrompt();
          this.term.write(this.lineBuffer);
          break;
        }
        case 'none':
          // Bell
          this.term.write('\x07');
          break;
      }
      return;
    }

    // ── Arrow keys ──
    if (data === '\x1b[A') {
      // Up arrow
      const prev = historyUp(this.lineBuffer);
      if (prev !== null) {
        this.clearLine();
        this.lineBuffer = prev;
        this.term.write(prev);
      }
      return;
    }

    if (data === '\x1b[B') {
      // Down arrow
      const next = historyDown();
      if (next !== null) {
        this.clearLine();
        this.lineBuffer = next;
        this.term.write(next);
      }
      return;
    }

    // ── Ignore other escape sequences ──
    if (data.startsWith('\x1b')) {
      return;
    }

    // ── Printable character ──
    // Filter to printable range
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      resetCompletion();
      this.lineBuffer += data;
      this.term.write(data);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private showPrompt(): void {
    this.term.write(PROMPT);
  }

  /** Erase the current input on the terminal line (doesn't clear lineBuffer). */
  private clearLine(): void {
    // Move back by lineBuffer.length and overwrite with spaces, then go back
    const len = this.lineBuffer.length;
    if (len === 0) return;
    this.term.write('\b'.repeat(len));
    this.term.write(' '.repeat(len));
    this.term.write('\b'.repeat(len));
  }

  private readonly _onWindowResize = (): void => {
    try {
      this.fitAddon.fit();
    } catch {
      // Ignore
    }
  };

  // ─── Command execution ────────────────────────────────────────────────────────

  private async executeCommand(input: string): Promise<void> {
    const ctx: CommandContext = {
      write: (line: string) => this.term.writeln(line),
      clearScreen: () => {
        this.term.clear();
      },
      setTheme: (name: string) => {
        this.themeManager.setTheme(name);
        // Update our own theme immediately
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
