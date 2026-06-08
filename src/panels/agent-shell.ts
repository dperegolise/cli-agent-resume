/**
 * src/panels/agent-shell.ts — AI Agent Shell panel (STUB)
 * Full implementation in milestone m3-agent-shell.
 */

import { createLogger } from '../utils/logging.js';

const log = createLogger('agent-shell');

export interface AgentShellOptions {
  element: HTMLElement;
}

/**
 * Initialize the agent shell panel.
 * Stub: logs mount point, does nothing else.
 */
export function initAgentShell(_options: AgentShellOptions): void {
  log.info('Agent shell panel stub — pending m3');
}
