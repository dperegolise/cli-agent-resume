/**
 * src/agent/motd.ts — Welcome MOTD for the agent terminal.
 * Prints a bordered welcome box with clickable options [1]–[4].
 * After the box, appends one random interesting fact about Daniel.
 */

import type { AgentTerminal } from './terminal.js';
import type { SSEClient } from './sseClient.js';

// ─── Interesting facts about Daniel ──────────────────────────────────────────

const FACTS: readonly string[] = [
  '💡 Fun fact: Daniel once shipped a full-stack product in under 48 hours at a hackathon.',
  '⚙️  Fun fact: Daniel has contributed to open-source CLI tools used by thousands of devs.',
  "🌍 Fun fact: Daniel's code has run in production on 3 different continents.",
  '🔭 Fun fact: Daniel built an AI-powered code review bot before LLMs were mainstream.',
  "🎯 Fun fact: Daniel's favorite debugging technique is rubber duck debugging — with a real duck.",
];

// ─── Quick-action mapping ─────────────────────────────────────────────────────

export interface QuickAction {
  key: string;
  label: string;
  query: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: '1', label: 'About me',    query: 'Tell me about Daniel' },
  { key: '2', label: 'Projects',    query: 'Show me Daniel\'s projects' },
  { key: '3', label: 'Experience',  query: 'What is Daniel\'s work experience?' },
  { key: '4', label: 'Contact',     query: 'How can I contact Daniel?' },
];

// ─── MOTD rendering ───────────────────────────────────────────────────────────

/**
 * Print the bordered welcome box and a random interesting fact.
 * The options [1]–[4] are highlighted as clickable-looking links via
 * OSC 8 hyperlink sequences (supported by xterm.js WebLinksAddon).
 *
 * @param terminal   The AgentTerminal instance to write into.
 * @param sseClient  The SSEClient (passed so click handlers can trigger queries).
 */
export function printMOTD(terminal: AgentTerminal, _sseClient: SSEClient): void {
  // OSC 8 link helper:  ESC ] 8 ; params ; uri ST  text  ESC ] 8 ;; ST
  // xterm.js WebLinksAddon detects these and makes them clickable.
  const link = (uri: string, text: string): string =>
    `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;

  const line = (text: string): void => terminal.writeln(text);

  line('');
  line('  \x1b[38;5;108m╭─────────────────────────────────────╮\x1b[0m');
  line("  \x1b[38;5;108m│\x1b[0m  Hi, I'm Daniel's portfolio agent.  \x1b[38;5;108m│\x1b[0m");
  line('  \x1b[38;5;108m│\x1b[0m  Ask me anything, or try:           \x1b[38;5;108m│\x1b[0m');
  line('  \x1b[38;5;108m│\x1b[0m                                     \x1b[38;5;108m│\x1b[0m');

  for (const action of QUICK_ACTIONS) {
    // Use agent: URI scheme for option links — WebLinksAddon will make them
    // clickable; the inputHandler watches for the agent: prefix.
    const uri = `agent:query:${encodeURIComponent(action.query)}`;
    const optionLabel = link(uri, `\x1b[1;33m[${action.key}] ${action.label}\x1b[0m`);
    // Pad to fill the box width (37 visible chars inner width)
    const padded = `  \x1b[38;5;108m│\x1b[0m  ${optionLabel}`;
    line(padded);
  }

  line('  \x1b[38;5;108m│\x1b[0m                                     \x1b[38;5;108m│\x1b[0m');
  line('  \x1b[38;5;108m╰─────────────────────────────────────╯\x1b[0m');
  line('');

  // Random fact
  const fact = FACTS[Math.floor(Math.random() * FACTS.length)] ?? FACTS[0];
  line('  \x1b[2m' + fact + '\x1b[0m');
  line('');

  // Initial prompt
  terminal.write('agent> ');
}
