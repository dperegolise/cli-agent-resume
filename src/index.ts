/**
 * src/index.ts — Application entry point
 * Initializes theme, loads manifest, and mounts all panels.
 * Wires: m2-layout, m3-agent-shell, m4-vim-panel, m5-cli-drawer.
 */

import '@xterm/xterm/css/xterm.css';
import { ThemeManager, applyThemeCSSVars } from './theme.js';
import { loadManifest } from './manifest.js';
import { bus, EVENT_TYPES } from './bus.js';
import { createLogger } from './utils/logging.js';
import { AgentTerminal } from './agent/terminal.js';
import { SSEClient } from './agent/sseClient.js';
import { printMOTD } from './agent/motd.js';
import { InputHandler } from './agent/inputHandler.js';
import { CLITerminal } from './drawer/terminal.js';
import { initVimEditor } from './editor/vim.js';
import { initFileExplorerPanel } from './explorer/tree.js';
import { initLayout } from './layout/responsive.js';
import { initResizers } from './layout/resizer.js';
import type { ThemeChangeEvent } from './types.js';

const log = createLogger('index');

/** Shared theme manager instance — passed to all panels. */
export const themeManager = new ThemeManager('default');

/** AgentTerminal singleton (for HMR cleanup). */
let agentTerminal: AgentTerminal | null = null;

/** CLI Terminal instance (kept for cleanup). */
let cliTerminal: CLITerminal | null = null;

/**
 * Wire the ThemeManager into the event bus.
 * Strategy §2: theme.ts must NOT import bus.ts (circular dep risk),
 * so we bridge from index.ts: ThemeManager.onThemeChange → bus.emit(THEME_CHANGE).
 */
function connectThemeToBus(): void {
  themeManager.onThemeChange((theme) => {
    bus.emit<ThemeChangeEvent>(EVENT_TYPES.THEME_CHANGE, { themeName: theme.name });
  });
}

/**
 * Main async initialization routine.
 * Called once when the page loads.
 */
export async function main(): Promise<void> {
  log.info('Portfolio starting up');

  // Apply initial theme CSS variables
  applyThemeCSSVars(themeManager.getTheme());

  // Bridge theme changes onto the event bus
  connectThemeToBus();

  // Load manifest
  let manifest;
  try {
    manifest = await loadManifest();
    log.info('Manifest loaded', { entries: manifest.entries.length });
  } catch (err) {
    log.error('Failed to load manifest', err);
    // Continue with empty manifest — panels will degrade gracefully
  }

  // Get DOM mount points
  const agentShellEl = document.getElementById('agent-shell');
  const fileExplorerEl = document.getElementById('file-explorer');
  const vimEditorEl = document.getElementById('vim-editor');
  const powerlineEl = document.getElementById('powerline-status-bar');
  const cliDrawerEl = document.getElementById('cli-drawer');

  if (!agentShellEl || !fileExplorerEl || !vimEditorEl || !powerlineEl || !cliDrawerEl) {
    log.error('One or more required DOM mount points not found');
    return;
  }

  // Initialise layout (m2): mobile breakpoint + drawer collapse
  const layout = initLayout();
  log.info('Layout initialised', { isMobile: layout.mobile.isMobile() });

  // Initialise panel drag-resizers
  initResizers();

  // Wait for fonts AND two animation frames before mounting xterm terminals.
  // Reasons:
  //   1. document.fonts.ready — xterm renders to canvas; if JetBrains Mono
  //      isn't loaded yet it falls back to system monospace with wrong char
  //      widths, producing $$$$ garbage glyphs.
  //   2. double-rAF — ensures the CSS grid has fully painted and every panel
  //      has its real pixel dimensions. fitAddon.fit() measures the container
  //      before writing any content; if the container is still zero-height,
  //      xterm opens at 1 row, writes the MOTD at that width, then reflows
  //      into the scrollback when the container expands, leaving >>>aaa debris.
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  // ── Mount Agent Shell (m3) ───────────────────────────────────────────────
  const terminal = new AgentTerminal(themeManager.getTheme(), themeManager);
  agentTerminal = terminal;

  terminal.mount(agentShellEl);

  const sseClient = new SSEClient(terminal);
  // Wire sseClient reference for OSC 8 link click routing
  terminal.setSseClient(sseClient);
  const inputHandler = new InputHandler(terminal, sseClient);

  inputHandler.attach();
  printMOTD(terminal, sseClient);
  terminal.focus();

  log.info('AgentTerminal mounted on #agent-shell');

  // ── File explorer (m4): loads manifest, renders NERDTree ────────────────
  void initFileExplorerPanel(fileExplorerEl).then(() => {
    log.info('File explorer mounted');
    // Populate the mobile sidebar with a clone of the desktop explorer tree.
    // data-path attributes are preserved by cloneNode; we add a delegated
    // click listener to re-wire navigation since event handlers don't clone.
    const mobileSidebarEl =
      document.getElementById('mobile-explorer-sidebar') ??
      document.getElementById('mobile-sidebar');
    if (mobileSidebarEl) {
      mobileSidebarEl.innerHTML = '';
      // Clone the inner .nerd-tree element (not #file-explorer) so the mobile
      // CSS rule that hides #file-explorer by ID doesn't apply to the clone.
      const treeEl = fileExplorerEl.querySelector('.nerd-tree') ?? fileExplorerEl;
      mobileSidebarEl.appendChild(treeEl.cloneNode(true));
      mobileSidebarEl.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
        if (!item?.dataset['path']) return;
        bus.emit(EVENT_TYPES.FOCUS_FILE, {
          path: item.dataset['path'],
          triggerSource: 'explorer',
        });
      });
    }
  }).catch((err: unknown) => {
    log.error('File explorer failed to mount', err);
  });

  // ── Vim editor (m4): CodeMirror 6 + vim keybindings, read-only ──────────
  initVimEditor(vimEditorEl, powerlineEl);
  log.info('Vim editor mounted');

  // ── CLI drawer terminal (m5) ─────────────────────────────────────────────
  cliTerminal = new CLITerminal(themeManager);
  cliTerminal.mount(cliDrawerEl);

  log.info('All panels mounted', { manifestEntries: manifest?.entries.length ?? 0 });
}

/**
 * Cleanup for hot module reload.
 */
export function onUnload(): void {
  log.debug('HMR unload');
  agentTerminal?.dispose();
  agentTerminal = null;
  cliTerminal?.dispose();
  cliTerminal = null;
  // Clear bus listeners on HMR to prevent handler accumulation
  bus.clear();
}

// Auto-start when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void main());
} else {
  void main();
}

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(onUnload);
}
