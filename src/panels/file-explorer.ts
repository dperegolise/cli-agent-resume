/**
 * src/panels/file-explorer.ts — File Explorer panel
 * Wires up the NERDTree DOM component into the DOM mount point.
 * Implemented by milestone m4-vim-panel.
 */

import { createLogger } from '../utils/logging.js';
import { initFileExplorerPanel } from '../explorer/tree.js';

const log = createLogger('file-explorer');

export interface FileExplorerOptions {
  element: HTMLElement;
}

/**
 * Initialize the file explorer panel.
 * Loads the manifest and renders the NERDTree DOM tree.
 */
export function initFileExplorer(options: FileExplorerOptions): void {
  log.info('File explorer initializing');
  void initFileExplorerPanel(options.element).then(() => {
    log.info('File explorer mounted');
  }).catch((err: unknown) => {
    log.error('File explorer failed to mount', err);
  });
}
