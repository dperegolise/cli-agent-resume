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
import type { ThemeManager } from '../theme.js';
import type { SSEClient } from './sseClient.js';

// ─── AgentTerminal ────────────────────────────────────────────────────────────

export class AgentTerminal {
  private readonly term: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly webLinksAddon: WebLinksAddon;
  private readonly themeManager: ThemeManager;
  private sseClient?: SSEClient;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeTheme: (() => void) | null = null;

  constructor(initialTheme: ThemeConfig, themeManager: ThemeManager) {
    this.themeManager = themeManager;
    this.fitAddon = new FitAddon();

    // FIX 2: WebLinksAddon with custom handler for agent:query: URIs
    this.webLinksAddon = new WebLinksAddon((_event, uri) => {
      if (uri.startsWith('agent:query:')) {
        try {
          const query = decodeURIComponent(uri.slice('agent:query:'.length));
          if (this.sseClient) {
            void this.sseClient.sendMessage(query);
          }
        } catch {
          // ignore decode errors
        }
      } else {
        window.open(uri, '_blank');
      }
    });

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
   * Set the SSEClient reference so OSC 8 link clicks can route to sendMessage.
   * Call this after constructing the SSEClient.
   */
  setSseClient(client: SSEClient): void {
    this.sseClient = client;
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

    // FIX 1: Subscribe to theme changes — use themeName to look up and apply the new theme.
    // The emitter (cmdTheme) already called themeManager.setTheme(), so getTheme() returns
    // the new theme. We just re-read and apply it to xterm directly (no double setTheme).
    this.unsubscribeTheme = bus.subscribe<ThemeChangeEvent>(
      EVENT_TYPES.THEME_CHANGE,
      (evt) => {
        if (evt.themeName) {
          try {
            this.term.options.theme = toXtermTheme(this.themeManager.getTheme());
          } catch {
            // ignore
          }
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
