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

// ─── Command handlers ─────────────────────────────────────────────────────────

function cmdHelp(ctx: CommandContext): void {
  // Each entry: [command+args visible text, description, command+args ansi string]
  // visible width is used for padding; ansi string is what gets printed.
  type Row = { vis: string; ansi: string; desc: string };

  const r = (cmd: string, args: string, desc: string): Row => {
    const cmdA = colorize(ANSI.brightGreen, cmd);
    const argsA = args ? ' ' + colorize(ANSI.cyan, args) : '';
    return { vis: cmd + (args ? ' ' + args : ''), ansi: cmdA + argsA, desc };
  };

  const left: Row[] = [
    r('help',   '',          'This help'),
    r('ls',     '[section]', 'List pages'),
    r('view',   '<path>',    'Open in editor  (about · projects · contact)'),
    r('search', '<query>',   'Search portfolio'),
    r('clear',  '',          'Clear terminal'),
    r('theme',  '<name>',    'Switch color theme'),
  ];

  const right: Row[] = [
    r('cat',  '<path>',     'Print file'),
    r('grep', '<pat>',      'Filter (-i -n)'),
    r('sed',  's/a/b/[g]',  'Substitute'),
    r('wc',   '[-l -w -c]', 'Count lines/words'),
    r('head', '[-n N]',     'First N lines'),
    r('tail', '[-n N]',     'Last N lines'),
  ];

  const leftVisW  = Math.max(...left.map(r  => r.vis.length));
  const leftDescW = Math.max(...left.map(r  => r.desc.length));
  const rightVisW = Math.max(...right.map(r => r.vis.length));

  // Pad visible content to fixed width using spaces (ANSI codes don't count)
  const padRight = (s: string, visLen: number, target: number) =>
    s + ' '.repeat(Math.max(0, target - visLen));

  const SEP = colorize(ANSI.dim, '  │  ');
  const hdr = (t: string) => colorize(ANSI.bold + ANSI.brightYellow, t);

  const leftHdrVis  = 'commands';
  const rightHdrVis = 'file commands';
  const leftHdr  = padRight(hdr(leftHdrVis),  leftHdrVis.length,  leftVisW + 2 + leftDescW);
  const rightHdr = hdr(rightHdrVis);

  const rows = Math.max(left.length, right.length);

  ctx.write('');
  ctx.write(`  ${leftHdr}${SEP}${rightHdr}`);
  ctx.write('  ' + colorize(ANSI.dim, '─'.repeat(leftVisW + 2 + leftDescW) + '──┼──' + '─'.repeat(rightVisW + 2 + 20)));

  for (let i = 0; i < rows; i++) {
    const l = left[i];
    const rx = right[i];

    const lAnsi = l ? padRight(l.ansi,  l.vis.length,  leftVisW) + '  ' + padRight(l.desc, l.desc.length, leftDescW) : ' '.repeat(leftVisW + 2 + leftDescW);
    const lVis  = l ? leftVisW + 2 + leftDescW : leftVisW + 2 + leftDescW;
    const rAnsi = rx ? padRight(rx.ansi, rx.vis.length, rightVisW) + '  ' + rx.desc : '';

    ctx.write(`  ${padRight(lAnsi, lVis, lVis)}${SEP}${rAnsi}`);
  }

  ctx.write('  ' + colorize(ANSI.dim, '─'.repeat(leftVisW + 2 + leftDescW) + '──┴──' + '─'.repeat(rightVisW + 2 + 20)));
  ctx.write(`  ${colorize(ANSI.dim, 'pipe: cat about.md | grep -i skills | wc -l')}`);
  ctx.write('');
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

// ─── cat ─────────────────────────────────────────────────────────────────────

async function fetchFileContent(path: string): Promise<string | null> {
  // Normalise: strip leading slash, ensure .md
  const clean = path.replace(/^\//, '');
  if (!validatePath(clean)) return null;
  try {
    const resp = await fetch(`/www/${clean}`);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function cmdCat(ctx: CommandContext, args: string[]): Promise<string | null> {
  const path = args[0]?.trim();
  if (!path) {
    ctx.write(colorize(ANSI.red, 'cat: missing filename'));
    return null;
  }
  const content = await fetchFileContent(path);
  if (content === null) {
    ctx.write(colorize(ANSI.red, `cat: ${path}: No such file`));
    return null;
  }
  // Return content for piping; also write to terminal if no pipe follows
  return content;
}

// ─── grep ─────────────────────────────────────────────────────────────────────

function cmdGrep(args: string[], stdin: string | null, ctx: CommandContext): string | null {
  // Usage: grep [-i] [-n] <pattern> [file]
  let pattern = '';
  let caseInsensitive = false;
  let showLineNumbers = false;
  const fileArgs: string[] = [];

  for (const arg of args) {
    if (arg === '-i') { caseInsensitive = true; continue; }
    if (arg === '-n') { showLineNumbers = true; continue; }
    if (arg === '-in' || arg === '-ni') { caseInsensitive = true; showLineNumbers = true; continue; }
    if (!pattern) { pattern = arg; continue; }
    fileArgs.push(arg);
  }

  if (!pattern) {
    ctx.write(colorize(ANSI.red, 'grep: missing pattern'));
    return null;
  }

  const source = stdin ?? '';
  const flags = caseInsensitive ? 'i' : '';
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    ctx.write(colorize(ANSI.red, `grep: invalid pattern: ${pattern}`));
    return null;
  }

  const lines = source.split('\n');
  const matched = lines
    .map((line, i) => ({ line, num: i + 1 }))
    .filter(({ line }) => re.test(line));

  const output = matched
    .map(({ line, num }) => showLineNumbers ? `${colorize(ANSI.dim, String(num) + ':')}${line}` : line)
    .join('\n');

  return output || null;
}

// ─── sed ─────────────────────────────────────────────────────────────────────

function cmdSed(args: string[], stdin: string | null, ctx: CommandContext): string | null {
  // Supports: sed 's/pattern/replacement/[g][i]'
  const expr = args[0]?.trim();
  if (!expr) {
    ctx.write(colorize(ANSI.red, "sed: missing expression. Usage: sed 's/pattern/replacement/flags'"));
    return null;
  }
  if (!stdin) {
    ctx.write(colorize(ANSI.red, 'sed: no input (pipe from cat first)'));
    return null;
  }

  const match = expr.match(/^s([^\w\s])(.*?)\1(.*?)\1([gi]*)$/);
  if (!match) {
    ctx.write(colorize(ANSI.red, `sed: unsupported expression: ${expr}`));
    return null;
  }

  const [, , pattern, replacement, flagStr] = match;
  const flags = (flagStr?.includes('g') ? 'g' : '') + (flagStr?.includes('i') ? 'i' : '');
  let re: RegExp;
  try {
    re = new RegExp(pattern!, flags);
  } catch {
    ctx.write(colorize(ANSI.red, `sed: invalid pattern: ${pattern}`));
    return null;
  }

  return stdin.replace(re, replacement!);
}

// ─── wc ──────────────────────────────────────────────────────────────────────

function cmdWc(args: string[], stdin: string | null, ctx: CommandContext): string | null {
  const text = stdin ?? '';
  const lines = text.split('\n').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  if (args.includes('-l')) return String(lines);
  if (args.includes('-w')) return String(words);
  if (args.includes('-c')) return String(chars);

  ctx.write(`  ${colorize(ANSI.brightCyan, String(lines))} lines  ${colorize(ANSI.brightCyan, String(words))} words  ${colorize(ANSI.brightCyan, String(chars))} chars`);
  return null;
}

// ─── head / tail ─────────────────────────────────────────────────────────────

function cmdHead(args: string[], stdin: string | null): string | null {
  const nFlag = args.findIndex(a => a === '-n');
  const n = nFlag !== -1 ? parseInt(args[nFlag + 1] ?? '10', 10) : 10;
  return (stdin ?? '').split('\n').slice(0, n).join('\n');
}

function cmdTail(args: string[], stdin: string | null): string | null {
  const nFlag = args.findIndex(a => a === '-n');
  const n = nFlag !== -1 ? parseInt(args[nFlag + 1] ?? '10', 10) : 10;
  return (stdin ?? '').split('\n').slice(-n).join('\n');
}

// ─── Pipeline executor ────────────────────────────────────────────────────────

/**
 * Split input on unquoted `|` characters and run each segment in sequence,
 * threading stdout from one command as stdin of the next.
 */
async function executePipeline(input: string, ctx: CommandContext): Promise<void> {
  const segments = input.split(/\s*\|\s*/);
  let stdin: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!.trim();
    if (!seg) continue;

    const parts = seg.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    const cmd = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));
    const isLast = i === segments.length - 1;

    let output: string | null = null;

    switch (cmd) {
      case 'cat':
        output = await cmdCat(ctx, args);
        if (output === null) return;
        if (isLast) { for (const l of output.split('\n')) ctx.write(l); return; }
        break;

      case 'grep':
        output = cmdGrep(args, stdin, ctx);
        if (output === null) { if (isLast) ctx.write(colorize(ANSI.dim, '(no matches)')); return; }
        if (isLast) { for (const l of output.split('\n')) ctx.write(l); return; }
        break;

      case 'sed':
        output = cmdSed(args, stdin, ctx);
        if (output === null) return;
        if (isLast) { for (const l of output.split('\n')) ctx.write(l); return; }
        break;

      case 'wc':
        cmdWc(args, stdin, ctx);
        return;

      case 'head':
        output = cmdHead(args, stdin);
        if (isLast && output !== null) { for (const l of output.split('\n')) ctx.write(l); return; }
        break;

      case 'tail':
        output = cmdTail(args, stdin);
        if (isLast && output !== null) { for (const l of output.split('\n')) ctx.write(l); return; }
        break;

      default:
        // Not a pipeable command — fall through to normal dispatch for single-segment
        if (segments.length === 1) return;
        ctx.write(colorize(ANSI.red, `${cmd}: not supported in pipeline`));
        return;
    }

    stdin = output;
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function dispatch(input: string, ctx: CommandContext): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  // Route to pipeline executor if input contains a pipe or starts with cat/grep/sed/wc/head/tail
  const pipeableLeaders = ['cat', 'grep', 'sed', 'wc', 'head', 'tail'];
  const firstWord = trimmed.split(/\s+/)[0]!.toLowerCase();
  if (trimmed.includes('|') || pipeableLeaders.includes(firstWord)) {
    await executePipeline(trimmed, ctx);
    return;
  }

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
