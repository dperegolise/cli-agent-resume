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

const R  = '\x1b[0m';
const B  = '\x1b[1m';
const D  = '\x1b[2m';

const G4 = '\x1b[38;5;99m';    // purple
const G6 = '\x1b[38;5;141m';   // bright purple
const G7 = '\x1b[38;5;177m';   // lavender

const AQ = '\x1b[38;5;60m';    // dim slate-blue (borders)
const YL = '\x1b[38;5;214m';   // gruvbox orange (keys)
const WH = '\x1b[38;5;223m';   // gruvbox fg light
const GR = '\x1b[38;5;246m';   // mid-gray
const RD = '\x1b[38;5;167m';   // gruvbox red
const AM = '\x1b[38;5;214m';   // amber
const GN = '\x1b[38;5;142m';   // gruvbox green (icon accent)
const CY = '\x1b[38;5;108m';   // gruvbox aqua

// ─── MOTD ─────────────────────────────────────────────────────────────────────

export function printMOTD(terminal: AgentTerminal, _sseClient: SSEClient): void {
  const link = (uri: string, text: string): string =>
    `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;
  const ln = (text = ''): void => terminal.writeln(text);

  // ── Header: colored tagline ──────────────────────────────────────────────
  // Tagline visible width: "daniel peregolise  ·  ai/ml  ·  systems" = 40 chars
  ln();
  ln(`  ${B}${G7}daniel peregolise${R}  ${D}${GR}·${R}  ${CY}ai/ml${R}  ${D}${GR}·${R}  ${GN}systems${R}`);
  ln(`   ${AQ}${'─'.repeat(36)}${R}`);
  ln();

  // ── Codex-style ASCII box ────────────────────────────────────────────────
  // Box inner width = 34. Outer = 36 (matches rule above).
  // Visible inner must be exactly 34 chars per row.
  //   Row 1: 2 + icon(2) + 2 + "Portfolio Agent"(15) + 4 + "v1.2.4"(6) + 3 = 34
  //   Row 2: 6 + "gpt-oss-120b"(12) + 16 = 34

  const boxW  = 34;
  const tl    = `${D}${AQ}╭${'─'.repeat(boxW)}╮${R}`;
  const bl    = `${D}${AQ}╰${'─'.repeat(boxW)}╯${R}`;
  const side  = `${D}${AQ}│${R}`;
  const icon  = `${B}${G4}◆${G6}◆${R}`;

  // Row 1: 2 + 2 + 2 + 15 + 4 + 6 + 3 = 34
  const row1 = `  ${icon}  ${B}${WH}Portfolio Agent${R}    ${D}${GR}v1.2.4${R}   `;
  // Row 2: 6 + 12 + 16 = 34
  const row2 = `      ${D}${GR}gpt-oss-120b${R}                `;

  ln(`   ${tl}`);
  ln(`   ${side}${row1}${side}`);
  ln(`   ${side}${row2}${side}`);
  ln(`   ${bl}`);
  ln();

  // ── Tagline / quick actions ──────────────────────────────────────────────
  for (const action of QUICK_ACTIONS) {
    const uri = `agent:query:${encodeURIComponent(action.query)}`;
    const keyPart   = `${B}${YL}[${action.key}]${R}`;
    const labelPart = `${WH}${action.label}${R}`;
    ln(`  ${link(uri, `${keyPart} ${labelPart}`)}`);
  }

  ln();
  ln(`  ${D}${RD}▸${R}${D}${GR} type anything to ask the agent${R}`);
  ln();

  terminal.write('agent> ');
  terminal.scrollToBottom();
}

// Suppress unused — kept for palette reference
void [B, D, AM];
