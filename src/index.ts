/**
 * src/index.ts — Application entry point
 * Initializes theme, loads manifest, and mounts all panels.
 */

import { ThemeManager, applyThemeCSSVars } from './theme.js';
import { loadManifest } from './manifest.js';
import { createLogger } from './utils/logging.js';
import { initAgentShell } from './panels/agent-shell.js';
import { initVimPanel } from './panels/vim-panel.js';
import { initFileExplorer } from './panels/file-explorer.js';
import { CLITerminal } from './drawer/terminal.js';

const log = createLogger('index');

/** Shared theme manager instance — passed to all panels. */
export const themeManager = new ThemeManager('gruvbox-dark');

/** CLI Terminal instance (kept for cleanup). */
let cliTerminal: CLITerminal | null = null;

/**
 * Main async initialization routine.
 * Called once when the page loads.
 */
export async function main(): Promise<void> {
  log.info('Portfolio starting up');

  // Apply initial theme CSS variables
  applyThemeCSSVars(themeManager.getTheme());

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

  // Mount panels (stubs for now; each milestone fills these in)
  initAgentShell({ element: agentShellEl });
  initFileExplorer({ element: fileExplorerEl });
  initVimPanel({ editorElement: vimEditorEl, statusBarElement: powerlineEl });

  // Mount CLI drawer terminal (m5)
  cliTerminal = new CLITerminal(themeManager);
  cliTerminal.mount(cliDrawerEl);

  log.info('All panels mounted', { manifestEntries: manifest?.entries.length ?? 0 });
}

/**
 * Cleanup for hot module reload.
 */
export function onUnload(): void {
  log.debug('HMR unload');
  cliTerminal?.dispose();
  cliTerminal = null;
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
