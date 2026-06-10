/**
 * src/agent/mdAnsi.ts — Lightweight markdown → ANSI escape converter.
 * Covers the subset agents typically emit: headings, bold, italic, inline code,
 * fenced code blocks, bullet/numbered lists, blockquotes, and horizontal rules.
 * No external dependencies.
 */

// ─── Default theme palette ────────────────────────────────────────────────────

const R  = '\x1b[0m';
const B  = '\x1b[1m';
const DIM = '\x1b[2m';
const IT = '\x1b[3m';
const H1 = '\x1b[33m';   // yellow (ANSI 3, closest standard to #d79921)
const H2 = '\x1b[92m';   // bright-green   (ANSI 10)
const H3 = '\x1b[92m';   // bright-green   (ANSI 10)
const H4 = '\x1b[92m';   // bright-green   (ANSI 10)
const LINK = '\x1b[96m'; // bright-cyan    (ANSI 14)
const BOLD_FG = '\x1b[93m';    // bright-yellow  (ANSI 11)
const CODE_FG = '\x1b[96m';    // bright-cyan
const CODE_BG = '\x1b[48;5;235m';  // dark bg tint (near-neutral, works on any dark theme)
const BLOCK_BORDER = '\x1b[90m';   // bright-black (dim gray)
const QUOTE_FG = '\x1b[90m';       // bright-black
const BULLET = '\x1b[93m';         // bright-yellow
const HR_COLOR = '\x1b[90m';       // bright-black

// ─── OSC 8 hyperlink helper ───────────────────────────────────────────────────

function osc8(uri: string, text: string): string {
  return `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ─── Inline formatting ────────────────────────────────────────────────────────

function applyInline(text: string, validPaths?: Set<string>): string {
  text = text.replace(/`([^`]+)`/g, `${CODE_BG}${CODE_FG}$1${R}`);
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, `${B}${BOLD_FG}${IT}$1${R}`);
  text = text.replace(/\*\*(.+?)\*\*/g, `${B}${BOLD_FG}$1${R}`);
  text = text.replace(/__(.+?)__/g, `${B}${BOLD_FG}$1${R}`);
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${IT}$1${R}`);
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, `${IT}$1${R}`);
  // Markdown links — emit as OSC 8 if the target is a known portfolio path, otherwise dim text
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const clean = href.replace(/^\.\//, '');
    if (validPaths?.has(clean)) {
      const uri = `agent:focus:${encodeURIComponent(clean)}`;
      return osc8(uri, `${LINK}${label}${R}`);
    }
    return `${LINK}${label}${R}${DIM} (${href})${R}`;
  });
  // Bare portfolio paths (e.g. projects/index.md) not already inside a link
  if (validPaths) {
    text = text.replace(/(?<!\()\b([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)\.md\b(?!\))/g,
      (_m, stem: string) => {
        const path = `${stem}.md`;
        if (validPaths.has(path)) {
          const uri = `agent:focus:${encodeURIComponent(path)}`;
          return osc8(uri, `${LINK}${path}${R}`);
        }
        return _m;
      },
    );
  }
  return text;
}

// ─── Table rendering ─────────────────────────────────────────────────────────

const TABLE_HEADER = '\x1b[93m';   // bright-yellow
const TABLE_BORDER = '\x1b[90m';   // bright-black
const TABLE_MAX_WIDTH = 46;

function truncate(s: string, max: number): string {
  if (visLen(s) <= max) return s;
  // Slice by visible chars, preserving ANSI escapes
  let vis = 0;
  let i = 0;
  while (i < s.length) {
    // eslint-disable-next-line no-control-regex
    const esc = s.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (esc) { i += esc[0].length; continue; }
    if (vis >= max - 1) break;
    vis++; i++;
  }
  return s.slice(0, i) + '…' + R;
}

function renderTable(rows: string[][], validPaths?: Set<string>): string[] {
  const dataRows = rows.filter((_, i) => i !== 1); // skip separator row
  if (!dataRows.length) return [];
  const colCount = Math.max(...dataRows.map((r) => r.length));

  // Normalize cells: collapse newlines and extra whitespace to a single space
  const normalized = dataRows.map((row) =>
    Array.from({ length: colCount }, (_, c) =>
      (row[c] ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(),
    ),
  );

  // Measure natural width from plain cell text (before ANSI)
  const natural: number[] = Array(colCount).fill(0);
  for (const row of normalized) {
    for (let c = 0; c < colCount; c++) {
      natural[c] = Math.max(natural[c]!, (row[c] ?? '').length);
    }
  }

  const borders = (colCount + 1) + colCount * 2;
  const available = Math.max(TABLE_MAX_WIDTH - borders, colCount * 4);
  const totalNatural = natural.reduce((a, b) => a + b, 0) || 1;
  const widths: number[] = natural.map((n) =>
    Math.max(4, Math.floor((n / totalNatural) * available)),
  );

  // pad uses visLen so ANSI escapes don't count against the column width
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - visLen(s)));
  const hLine = (l: string, m: string, r: string) =>
    `${TABLE_BORDER}${l}${widths.map((w) => '─'.repeat(w + 2)).join(m)}${r}${R}`;

  const out: string[] = [];
  out.push(hLine('┌', '┬', '┐'));
  normalized.forEach((row, ri) => {
    const cells = Array.from({ length: colCount }, (_, c) => {
      const rendered = applyInline(row[c] ?? '', validPaths);
      const clipped = truncate(rendered, widths[c]!);
      const padded = pad(clipped, widths[c]!);
      return ri === 0 ? `${TABLE_HEADER}${padded}${R}` : padded;
    });
    out.push(`${TABLE_BORDER}│${R} ${cells.join(` ${TABLE_BORDER}│${R} `)} ${TABLE_BORDER}│${R}`);
    if (ri === 0) out.push(hLine('├', '┼', '┤'));
  });
  out.push(hLine('└', '┴', '┘'));
  return out;
}

// ─── Block-level rendering ────────────────────────────────────────────────────

export function markdownToAnsi(md: string, validPaths?: Set<string>): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let tableRows: string[][] = [];

  const isTableRow = (s: string) => /^\s*\|/.test(s);
  const flushTable = () => {
    if (tableRows.length) {
      renderTable(tableRows, validPaths).forEach((l) => out.push(l));
      tableRows = [];
    }
  };

  for (const raw of lines) {
    if (!inFence && !isTableRow(raw)) flushTable();

    // ── Fenced code blocks ─────────────────────────────────────────────────
    if (!inFence && /^```/.test(raw)) {
      inFence = true;
      fenceLang = raw.slice(3).trim();
      const label = fenceLang ? ` ${fenceLang} ` : '';
      out.push(`${BLOCK_BORDER}┌──${label}${R}`);
      continue;
    }
    if (inFence && /^```/.test(raw)) {
      inFence = false;
      fenceLang = '';
      out.push(`${BLOCK_BORDER}└─${R}`);
      continue;
    }
    if (inFence) {
      out.push(`${BLOCK_BORDER}│${R} ${DIM}${raw}${R}`);
      continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^(?:---|\*\*\*|___)$/.test(raw.trim())) {
      out.push(`${HR_COLOR}${'─'.repeat(36)}${R}`);
      continue;
    }

    // ── Headings ───────────────────────────────────────────────────────────
    const headingMatch = raw.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = applyInline(headingMatch[2]!, validPaths);
      const colors = [H1, H2, H3, H4];
      const color = colors[Math.min(level, 4) - 1]!;
      const prefix = level === 1 ? `${B}${color}` : color;
      out.push(`${prefix}${text}${R}`);
      if (level === 1) out.push(`${HR_COLOR}${'─'.repeat(36)}${R}`);
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    if (raw.startsWith('> ')) {
      out.push(`${QUOTE_FG}▎ ${applyInline(raw.slice(2), validPaths)}${R}`);
      continue;
    }

    // ── Bullet list ────────────────────────────────────────────────────────
    const bulletMatch = raw.match(/^(\s*)[-*+]\s+(.*)/);
    if (bulletMatch) {
      const indent = Math.floor((bulletMatch[1]?.length ?? 0) / 2);
      const pad = '  '.repeat(indent);
      out.push(`${pad}${BULLET}·${R} ${applyInline(bulletMatch[2]!, validPaths)}`);
      continue;
    }

    // ── Numbered list ──────────────────────────────────────────────────────
    const numMatch = raw.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (numMatch) {
      const indent = Math.floor((numMatch[1]?.length ?? 0) / 2);
      const pad = '  '.repeat(indent);
      out.push(`${pad}${BULLET}${numMatch[2]}.${R} ${applyInline(numMatch[3]!, validPaths)}`);
      continue;
    }

    // ── Table row ──────────────────────────────────────────────────────────
    if (isTableRow(raw)) {
      tableRows.push(raw.split('|').slice(1, -1).map((c) => c.trim()));
      continue;
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (raw.trim() === '') {
      out.push('');
      continue;
    }

    // ── Normal paragraph text ──────────────────────────────────────────────
    out.push(applyInline(raw, validPaths));
  }
  flushTable();

  // Join with \r\n so xterm renders each line correctly.
  return out.join('\r\n');
}

// ─── ANSI-aware word-wrap ─────────────────────────────────────────────────────

/** Strip ANSI escape sequences to measure visible character width. */
export function visLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function wrapAnsiLine(line: string, maxCols: number, indent: number): string {
  if (visLen(line) <= maxCols) return line;
  const pad = ' '.repeat(indent);
  const words = line.split(' ');
  const result: string[] = [];
  let current = '';
  let currentVis = 0;

  for (const word of words) {
    const wordVis = visLen(word);
    const isFirst = current === '';
    if (!isFirst && currentVis + 1 + wordVis > maxCols) {
      result.push(current);
      current = pad + word;
      currentVis = indent + wordVis;
    } else {
      current = isFirst ? word : current + ' ' + word;
      currentVis = isFirst ? wordVis : currentVis + 1 + wordVis;
    }
  }
  if (current) result.push(current);
  return result.join('\r\n');
}

export function wrapAnsi(text: string, cols: number, rightMargin = 2): string {
  const maxCols = cols - rightMargin;
  return text
    .split('\r\n')
    .map((line) => {
      const bulletMatch = line.match(/^(\s*(?:·|\d+\.)\s)/);
      const indent = bulletMatch ? visLen(bulletMatch[1]!) : 0;
      return wrapAnsiLine(line, maxCols, indent);
    })
    .join('\r\n');
}
