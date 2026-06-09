/**
 * src/agent/motd.ts — Welcome MOTD for the agent terminal.
 */

import type { AgentTerminal } from './terminal.js';
import type { SSEClient } from './sseClient.js';

// ─── Quick-action mapping ─────────────────────────────────────────────────────

export interface QuickAction {
  key: string;
  label: string;
  query: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: '1', label: 'About me',   query: 'Tell me about Daniel' },
  { key: '2', label: 'Projects',   query: "Show me Daniel's projects" },
  { key: '3', label: 'Experience', query: "What is Daniel's work experience?" },
  { key: '4', label: 'Contact',    query: 'How can I contact Daniel?' },
];

// ─── ANSI palette ─────────────────────────────────────────────────────────────

const R  = '\x1b[0m';           // reset
const B  = '\x1b[1m';           // bold
const D  = '\x1b[2m';           // dim
const GN = '\x1b[38;5;142m';   // gruvbox yellow-green  (logo name)
const AQ = '\x1b[38;5;108m';   // gruvbox aqua          (borders + accents)
const YL = '\x1b[38;5;214m';   // gruvbox orange-yellow (keys)
const WH = '\x1b[38;5;223m';   // gruvbox fg light      (body text)

// ─── MOTD rendering ───────────────────────────────────────────────────────────

export function printMOTD(terminal: AgentTerminal, _sseClient: SSEClient): void {
  const link = (uri: string, text: string): string =>
    `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;

  const ln = (text = ''): void => terminal.writeln(text);

  // ── Logo block ──────────────────────────────────────────────────────────────
  //   Wide enough to feel substantial; narrow enough to fit the panel.
  //   Inner width: 37 chars.

  const border = `${AQ}│${R}`;
  const TL = `${AQ}╭${'─'.repeat(37)}╮${R}`;
  const BL = `${AQ}╰${'─'.repeat(37)}╯${R}`;
  const DIV = `${AQ}├${'─'.repeat(37)}┤${R}`;
  const pad = (text: string, vis: number) =>
    `${border} ${text}${' '.repeat(Math.max(0, 36 - vis))}${border}`;

  ln();
  ln(`  ${TL}`);
  ln(`  ${pad(`${B}${GN}Daniel Peregolise${R}`, 18)}`);
  ln(`  ${pad(`${D}${WH}engineer · ai/ml · systems${R}`, 26)}`);
  ln(`  ${DIV}`);
  ln(`  ${pad(`${WH}Hi — I'm Daniel's portfolio AI.${R}`, 31)}`);
  ln(`  ${pad(`${D}${WH}Ask me anything or pick a shortcut:${R}`, 35)}`);
  ln(`  ${pad('', 0)}`);

  for (const action of QUICK_ACTIONS) {
    const uri = `agent:query:${encodeURIComponent(action.query)}`;
    const keyStr  = `${B}${YL}[${action.key}]${R}`;
    const keyVis  = 3;
    const labelStr = `${WH}${action.label}${R}`;
    const labelVis = action.label.length;
    const entry = link(uri, `${keyStr} ${labelStr}`);
    ln(`  ${pad(`  ${entry}`, 2 + keyVis + 1 + labelVis)}`);
  }

  ln(`  ${pad('', 0)}`);
  ln(`  ${BL}`);
  ln();

  terminal.write('agent> ');
  terminal.scrollToBottom();
}
