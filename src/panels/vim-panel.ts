/**
 * src/panels/vim-panel.ts — Vim editor panel (STUB)
 * Full implementation in milestone m4-vim-panel.
 */

import { createLogger } from '../utils/logging.js';

const log = createLogger('vim-panel');

export interface VimPanelOptions {
  editorElement: HTMLElement;
  statusBarElement: HTMLElement;
}

/**
 * Initialize the Vim editor panel.
 * Stub: logs mount point, does nothing else.
 */
export function initVimPanel(_options: VimPanelOptions): void {
  log.info('Vim panel stub — pending m4');
}
