/**
 * src/panels/file-explorer.ts — File Explorer panel (STUB)
 * Full implementation in milestone m4-vim-panel.
 */

import { createLogger } from '../utils/logging.js';

const log = createLogger('file-explorer');

export interface FileExplorerOptions {
  element: HTMLElement;
}

/**
 * Initialize the file explorer panel.
 * Stub: logs mount point, does nothing else.
 */
export function initFileExplorer(_options: FileExplorerOptions): void {
  log.info('File explorer stub — pending m4');
}
