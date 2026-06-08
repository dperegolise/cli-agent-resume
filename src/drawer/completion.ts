/**
 * src/drawer/completion.ts — Tab completion for CLI drawer
 * Provides single/multi-match completion with cycle-on-repeated-Tab.
 */

import { getAllPaths } from '../manifest.js';
import { THEME_NAMES } from '../theme.js';

/** Known static command names. */
const COMMANDS = [
  'help',
  'ls',
  'view',
  'search',
  'about',
  'projects',
  'contact',
  'clear',
  'theme',
  'cat',
  'grep',
  'sed',
  'wc',
  'head',
  'tail',
];

// ─── Completion state ─────────────────────────────────────────────────────────

/** Tracks repeated Tab presses for cycling through multiple matches. */
let lastPartial = '';
let cycleMatches: string[] = [];
let cycleIndex = 0;

/**
 * Reset the cycle state.
 * Call this whenever the user types a character (not Tab).
 */
export function resetCompletion(): void {
  lastPartial = '';
  cycleMatches = [];
  cycleIndex = 0;
}

// ─── Core completion logic ────────────────────────────────────────────────────

/**
 * Build the candidate list for a given prefix.
 *
 * - If the line has no space (single token), candidates are command names.
 * - If the first token is 'view' or 'ls', candidates are manifest paths.
 * - If the first token is 'theme', candidates are theme names.
 */
function getCandidates(lineBeforeCursor: string): { candidates: string[]; prefix: string } {
  const parts = lineBeforeCursor.split(/\s+/);
  const firstToken = parts[0] ?? '';
  const hasSpace = lineBeforeCursor.includes(' ');

  if (!hasSpace) {
    // Completing the command itself
    return { candidates: COMMANDS, prefix: firstToken };
  }

  const lastToken = parts[parts.length - 1] ?? '';

  if (firstToken === 'view' || firstToken === 'ls' || firstToken === 'cat') {
    return { candidates: getAllPaths(), prefix: lastToken };
  }

  if (firstToken === 'theme') {
    return { candidates: THEME_NAMES, prefix: lastToken };
  }

  // No completion for other commands
  return { candidates: [], prefix: lastToken };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type CompletionResult =
  | { type: 'single'; completed: string }
  | { type: 'multiple'; matches: string[]; partial: string }
  | { type: 'cycle'; completed: string }
  | { type: 'none' };

/**
 * Compute tab completion for the current input line.
 *
 * Returns one of:
 *  - `single`   — exactly one match; replace partial with `completed`
 *  - `multiple` — more than one; show `matches`, keep `partial` input
 *  - `cycle`    — repeated Tab on the same partial; return next `completed`
 *  - `none`     — no candidates
 */
export function tabComplete(lineBeforeCursor: string): CompletionResult {
  // Repeated Tab on same partial → cycle
  if (lineBeforeCursor === lastPartial && cycleMatches.length > 1) {
    cycleIndex = (cycleIndex + 1) % cycleMatches.length;
    const match = cycleMatches[cycleIndex]!;
    return { type: 'cycle', completed: buildCompletion(lineBeforeCursor, match) };
  }

  // Fresh completion attempt
  const { candidates, prefix } = getCandidates(lineBeforeCursor);
  const matches = candidates.filter((c) => c.startsWith(prefix));

  if (matches.length === 0) {
    resetCompletion();
    return { type: 'none' };
  }

  if (matches.length === 1) {
    resetCompletion();
    const completed = buildCompletion(lineBeforeCursor, matches[0]!);
    return { type: 'single', completed };
  }

  // Multiple matches — save state for cycling
  lastPartial = lineBeforeCursor;
  cycleMatches = matches;
  cycleIndex = 0;
  return { type: 'multiple', matches, partial: lineBeforeCursor };
}

/**
 * Replace the last token in `line` with `match`.
 */
function buildCompletion(line: string, match: string): string {
  const lastSpaceIdx = line.lastIndexOf(' ');
  if (lastSpaceIdx === -1) {
    return match;
  }
  return line.slice(0, lastSpaceIdx + 1) + match;
}
