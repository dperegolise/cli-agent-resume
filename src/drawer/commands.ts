/**
 * src/drawer/commands.ts — CLI drawer command interpreter
 * Parses user input and dispatches to appropriate handlers.
 */

import { bus, EVENT_TYPES } from '../bus.js';
import {
  getManifestEntry,
  getAllPaths,
  validatePath,
} from '../manifest.js';
import { THEME_NAMES } from '../theme.js';
import type { FocusFileEvent, ThemeChangeEvent } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Write function provided by CLITerminal so commands can output text. */
export type WriteFn = (line: string) => void;

/** Dependencies injected from CLITerminal. */
export interface CommandContext {
  write: WriteFn;
  /** Clear the terminal screen. */
  clearScreen: () => void;
  /** Change theme via ThemeManager (also emits bus event). */
  setTheme: (name: string) => void;
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  brightYellow: '\x1b[93m',
  brightGreen: '\x1b[92m',
  brightCyan: '\x1b[96m',
  dim: '\x1b[2m',
};

function colorize(color: string, text: string): string {
  return `${color}${text}${ANSI.reset}`;
}

// ─── Help table ───────────────────────────────────────────────────────────────

const HELP_LINES = [
  '',
  colorize(ANSI.bold + ANSI.brightYellow, 'Available commands:'),
  '',
  `  ${colorize(ANSI.brightGreen, 'help')}              Show this help`,
  `  ${colorize(ANSI.brightGreen, 'ls')}                List top-level pages`,
  `  ${colorize(ANSI.brightGreen, 'ls')} ${colorize(ANSI.cyan, '<section>')}     List pages in a section`,
  `  ${colorize(ANSI.brightGreen, 'view')} ${colorize(ANSI.cyan, '<path>')}       Open file in editor`,
  `  ${colorize(ANSI.brightGreen, 'search')} ${colorize(ANSI.cyan, '<query>')}     Search the portfolio`,
  `  ${colorize(ANSI.brightGreen, 'about')}             View about.md`,
  `  ${colorize(ANSI.brightGreen, 'projects')}          View projects/index.md`,
  `  ${colorize(ANSI.brightGreen, 'contact')}           View contact.md`,
  `  ${colorize(ANSI.brightGreen, 'clear')}             Clear the terminal`,
  `  ${colorize(ANSI.brightGreen, 'theme')} ${colorize(ANSI.cyan, '<name>')}      Change theme (${THEME_NAMES.join(' | ')})`,
  '',
];

// ─── Command handlers ─────────────────────────────────────────────────────────

function cmdHelp(ctx: CommandContext): void {
  for (const line of HELP_LINES) {
    ctx.write(line);
  }
}

function cmdLs(ctx: CommandContext, args: string[]): void {
  const section = args[0]?.trim();
  const paths = getAllPaths();

  if (!section) {
    // Top-level: unique first path segments
    const topLevel = new Set<string>();
    for (const p of paths) {
      const firstSegment = p.split('/')[0] ?? p;
      topLevel.add(firstSegment);
    }

    ctx.write('');
    ctx.write(colorize(ANSI.bold + ANSI.brightYellow, 'Portfolio contents:'));
    ctx.write('');
    for (const item of topLevel) {
      const entry = getManifestEntry(item) ?? getManifestEntry(item + '/index.md');
      const label = entry?.title ? `  ${colorize(ANSI.brightCyan, item + '/')}  ${colorize(ANSI.dim, entry.title)}` : `  ${colorize(ANSI.brightCyan, item + '/')}`;
      ctx.write(label);
    }
    ctx.write('');
  } else {
    // Section: list paths that start with the section name
    const filtered = paths.filter((p) => p.startsWith(section + '/') || p === section + '.md');

    if (filtered.length === 0) {
      ctx.write(colorize(ANSI.red, `ls: no entries found for section '${section}'`));
      return;
    }

    ctx.write('');
    ctx.write(colorize(ANSI.bold + ANSI.brightYellow, `${section}:`));
    ctx.write('');
    for (const p of filtered) {
      const entry = getManifestEntry(p);
      const label = entry?.title
        ? `  ${colorize(ANSI.brightCyan, p)}  ${colorize(ANSI.dim, entry.title)}`
        : `  ${colorize(ANSI.brightCyan, p)}`;
      ctx.write(label);
    }
    ctx.write('');
  }
}

function cmdView(ctx: CommandContext, args: string[]): void {
  const rawPath = args[0]?.trim();
  if (!rawPath) {
    ctx.write(colorize(ANSI.red, 'view: missing path argument. Usage: view <path>'));
    return;
  }

  if (!validatePath(rawPath)) {
    ctx.write(colorize(ANSI.red, `view: invalid or unknown path '${rawPath}'`));
    ctx.write(colorize(ANSI.dim, "       Run 'ls' to see available paths."));
    return;
  }

  const payload: FocusFileEvent = {
    path: rawPath,
    triggerSource: 'cli',
  };
  bus.emit(EVENT_TYPES.FOCUS_FILE, payload);

  ctx.write(colorize(ANSI.brightGreen, `Opening ${rawPath}...`));
}

async function cmdSearch(ctx: CommandContext, args: string[]): Promise<void> {
  const query = args.join(' ').trim();
  if (!query) {
    ctx.write(colorize(ANSI.red, 'search: missing query. Usage: search <query>'));
    return;
  }

  ctx.write(colorize(ANSI.dim, `Searching for '${query}'...`));

  try {
    const resp = await fetch('/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: `search: ${query}` }],
        session_id: `cli-search-${Date.now()}`,
      }),
    });

    if (!resp.ok || !resp.body) {
      ctx.write(colorize(ANSI.red, `search: server error (${resp.status})`));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotResults = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const rawJson = line.slice(6).trim();
        if (rawJson === '[DONE]' || rawJson === '') continue;

        try {
          const event = JSON.parse(rawJson) as { type: string; results?: Array<{ path: string; title: string; excerpt: string; score: number }> };
          if (event.type === 'search_results' && Array.isArray(event.results)) {
            gotResults = true;
            ctx.write('');
            ctx.write(colorize(ANSI.bold + ANSI.brightYellow, `Results for '${query}':`));
            ctx.write('');
            for (const r of event.results) {
              ctx.write(`  ${colorize(ANSI.brightCyan, r.path)}  ${colorize(ANSI.dim, r.title)}`);
              if (r.excerpt) {
                ctx.write(`    ${colorize(ANSI.dim, r.excerpt)}`);
              }
            }
            ctx.write('');
          } else if (event.type === 'token') {
            // Ignore streaming tokens in search results
          } else if (event.type === 'done') {
            break;
          } else if (event.type === 'error') {
            ctx.write(colorize(ANSI.red, `search error: ${(event as { message?: string }).message ?? 'unknown'}`));
          }
        } catch {
          // Ignore malformed SSE lines
        }
      }
    }

    if (!gotResults) {
      ctx.write(colorize(ANSI.dim, `No results found for '${query}'.`));
    }
  } catch (err) {
    ctx.write(colorize(ANSI.red, `search: network error — ${(err as Error).message}`));
  }
}

function cmdTheme(ctx: CommandContext, args: string[]): void {
  const name = args[0]?.trim();
  if (!name) {
    ctx.write(colorize(ANSI.red, 'theme: missing name. Usage: theme <name>'));
    ctx.write(colorize(ANSI.dim, `  Available: ${THEME_NAMES.join(', ')}`));
    return;
  }

  if (!THEME_NAMES.includes(name)) {
    ctx.write(colorize(ANSI.red, `theme: unknown theme '${name}'`));
    ctx.write(colorize(ANSI.dim, `  Available: ${THEME_NAMES.join(', ')}`));
    return;
  }

  try {
    ctx.setTheme(name);
    // Also emit on the bus so all panels can react
    const payload: ThemeChangeEvent = { themeName: name };
    bus.emit(EVENT_TYPES.THEME_CHANGE, payload);
    ctx.write(colorize(ANSI.brightGreen, `Theme changed to '${name}'.`));
  } catch (err) {
    ctx.write(colorize(ANSI.red, `theme: ${(err as Error).message}`));
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Parse and dispatch a command string.
 * Returns a Promise so async commands (search) are awaitable.
 */
export async function dispatch(input: string, ctx: CommandContext): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
      cmdHelp(ctx);
      break;

    case 'ls':
      cmdLs(ctx, args);
      break;

    case 'view':
      cmdView(ctx, args);
      break;

    case 'search':
      await cmdSearch(ctx, args);
      break;

    case 'about':
      cmdView(ctx, ['about.md']);
      break;

    case 'projects':
      cmdView(ctx, ['projects/index.md']);
      break;

    case 'contact':
      cmdView(ctx, ['contact.md']);
      break;

    case 'clear':
      ctx.clearScreen();
      break;

    case 'theme':
      cmdTheme(ctx, args);
      break;

    default:
      ctx.write(colorize(ANSI.red, `command not found: ${cmd}. Type 'help' for commands.`));
      break;
  }
}
