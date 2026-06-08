/**
 * src/panels/vim-panel.ts — Vim editor panel
 * Wires up CodeMirror 6 + vim keybindings into the DOM mount points.
 * Implemented by milestone m4-vim-panel.
 */

import { createLogger } from '../utils/logging.js';
import { initVimEditor } from '../editor/vim.js';

export { initVimEditor };

const log = createLogger('vim-panel');

export interface VimPanelOptions {
  editorElement: HTMLElement;
  statusBarElement: HTMLElement;
}

/**
 * Initialize the Vim editor panel.
 * Mounts CodeMirror 6 + vim into the provided DOM elements.
 */
export function initVimPanel(options: VimPanelOptions): void {
  log.info('Vim panel initializing');
  initVimEditor(options.editorElement, options.statusBarElement);
  log.info('Vim panel mounted');
}
