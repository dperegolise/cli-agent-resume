/**
 * src/agent/terminal.ts — xterm.js AgentTerminal wrapper
 * Mounts a fully configured xterm.js terminal into #agent-shell.
 * Theme-aware, fit-on-resize, clickable links.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { toXtermTheme } from '../theme.js';
import { bus, EVENT_TYPES } from '../bus.js';
import type { ThemeConfig, ThemeChangeEvent } from '../types.js';

// ─── AgentTerminal ────────────────────────────────────────────────────────────

export class AgentTerminal {
  private readonly term: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly webLinksAddon: WebLinksAddon;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeTheme: (() => void) | null = null;

  constructor(initialTheme: ThemeConfig) {
    this.fitAddon = new FitAddon();
    this.webLinksAddon = new WebLinksAddon();

    this.term = new Terminal({
      fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      theme: toXtermTheme(initialTheme),
      allowProposedApi: true,
    });

    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.webLinksAddon);
  }

  /**
   * Mount the terminal into the given DOM element.
   * Should be called once after construction.
   */
  mount(element: HTMLElement): void {
    this.term.open(element);

    // Initial fit
    requestAnimationFrame(() => {
      this.fitAddon.fit();
    });

    // Fit on container resize
    this.resizeObserver = new ResizeObserver(() => {
      try {
        this.fitAddon.fit();
      } catch {
        // ResizeObserver may fire before xterm is ready — ignore
      }
    });
    this.resizeObserver.observe(element);

    // Also fit on window resize (belt-and-suspenders)
    window.addEventListener('resize', this._onWindowResize);

    // Subscribe to theme changes
    this.unsubscribeTheme = bus.subscribe<ThemeChangeEvent>(
      EVENT_TYPES.THEME_CHANGE,
      (payload) => {
        // ThemeChangeEvent only carries themeName; we need the full ThemeConfig.
        // Re-import lazily to avoid circular deps. Theme is applied in caller via
        // the ThemeManager; here we receive the pre-resolved ThemeConfig via the
        // bus payload.
        const evt = payload as ThemeChangeEvent & { theme?: ThemeConfig };
        if (evt.theme) {
          this.term.options.theme = toXtermTheme(evt.theme);
        }
      },
    );
  }

  /** Write text to the terminal (no trailing newline). */
  write(text: string): void {
    this.term.write(text);
  }

  /** Write text followed by a newline (\r\n for proper terminal rendering). */
  writeln(text: string): void {
    this.term.write(text + '\r\n');
  }

  /** Register a handler for user input data. Returns unsubscribe fn. */
  onData(handler: (data: string) => void): () => void {
    const disposable = this.term.onData(handler);
    return () => disposable.dispose();
  }

  /** Focus the terminal (capture keyboard input). */
  focus(): void {
    this.term.focus();
  }

  /** Clear the terminal viewport. */
  clear(): void {
    this.term.clear();
  }

  /** Current number of columns in the terminal. */
  get cols(): number {
    return this.term.cols;
  }

  /** Dispose and remove event listeners. */
  dispose(): void {
    window.removeEventListener('resize', this._onWindowResize);
    this.resizeObserver?.disconnect();
    this.unsubscribeTheme?.();
    this.term.dispose();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private readonly _onWindowResize = (): void => {
    try {
      this.fitAddon.fit();
    } catch {
      // ignore
    }
  };
}
