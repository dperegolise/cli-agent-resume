/**
 * src/index.ts — Application entry point
 * Initializes theme, loads manifest, and mounts all panels.
 */

import { ThemeManager, applyThemeCSSVars } from './theme.js';
import { loadManifest } from './manifest.js';
import { bus, EVENT_TYPES } from './bus.js';
import { createLogger } from './utils/logging.js';
import { initAgentShell } from './panels/agent-shell.js';
import { initCLIDrawer } from './panels/cli-drawer.js';
import { initVimEditor } from './editor/vim.js';
import { initFileExplorerPanel } from './explorer/tree.js';
import type { ThemeChangeEvent } from './types.js';

const log = createLogger('index');

/** Shared theme manager instance — passed to all panels. */
export const themeManager = new ThemeManager('gruvbox-dark');

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

  // Mount panels
  initAgentShell({ element: agentShellEl });

  // File explorer (m4): loads manifest, renders NERDTree
  void initFileExplorerPanel(fileExplorerEl).then(() => {
    log.info('File explorer mounted');
  }).catch((err: unknown) => {
    log.error('File explorer failed to mount', err);
  });

  // Vim editor (m4): CodeMirror 6 + vim keybindings, read-only
  initVimEditor(vimEditorEl, powerlineEl);
  log.info('Vim editor mounted');

  initCLIDrawer({ element: cliDrawerEl });

  log.info('All panels mounted', { manifestEntries: manifest?.entries.length ?? 0 });
}

/**
 * Cleanup for hot module reload.
 */
export function onUnload(): void {
  log.debug('HMR unload');
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
