/**
 * src/panels/cli-drawer.ts — CLI Drawer panel (STUB)
 * Full implementation in milestone m5-cli-drawer.
 */

import { createLogger } from '../utils/logging.js';

const log = createLogger('cli-drawer');

export interface CLIDrawerOptions {
  element: HTMLElement;
}

/**
 * Initialize the CLI drawer panel.
 * Stub: logs mount point, does nothing else.
 */
export function initCLIDrawer(_options: CLIDrawerOptions): void {
  log.info('CLI drawer stub — pending m5');
}
