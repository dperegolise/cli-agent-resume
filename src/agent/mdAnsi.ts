/**
 * src/agent/mdAnsi.ts — Lightweight markdown → ANSI escape converter.
 * Covers the subset agents typically emit: headings, bold, italic, inline code,
 * fenced code blocks, bullet/numbered lists, blockquotes, and horizontal rules.
 * No external dependencies.
 */

// ─── Gruvbox palette (matches the vim editor theme) ──────────────────────────

const R  = '\x1b[0m';
const B  = '\x1b[1m';
const DIM = '\x1b[2m';
const IT = '\x1b[3m';
const H1 = '\x1b[38;5;167m';    // gruvbox red
const H2 = '\x1b[38;5;214m';    // gruvbox orange
const H3 = '\x1b[38;5;142m';    // gruvbox yellow-green
const H4 = '\x1b[38;5;108m';    // gruvbox aqua
const CODE_FG = '\x1b[38;5;108m';
const CODE_BG = '\x1b[48;5;237m';
const BLOCK_BORDER = '\x1b[38;5;243m';
const QUOTE_FG = '\x1b[38;5;243m';
const BULLET = '\x1b[38;5;214m';
const HR_COLOR = '\x1b[38;5;239m';

// ─── Inline formatting ────────────────────────────────────────────────────────

function applyInline(text: string): string {
  text = text.replace(/`([^`]+)`/g, `${CODE_BG}${CODE_FG}$1${R}`);
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, `${B}${IT}$1${R}`);
  text = text.replace(/\*\*(.+?)\*\*/g, `${B}$1${R}`);
  text = text.replace(/__(.+?)__/g, `${B}$1${R}`);
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${IT}$1${R}`);
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, `${IT}$1${R}`);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${CODE_FG}$1${R}${DIM} ($2)${R}`);
  return text;
}

// ─── Block-level rendering ────────────────────────────────────────────────────

export function markdownToAnsi(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceLang = '';

  for (const raw of lines) {
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
      const text = applyInline(headingMatch[2]!);
      const colors = [H1, H2, H3, H4];
      const color = colors[Math.min(level, 4) - 1]!;
      const prefix = level === 1 ? `${B}${color}` : color;
      out.push(`${prefix}${text}${R}`);
      if (level === 1) out.push(`${HR_COLOR}${'─'.repeat(36)}${R}`);
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    if (raw.startsWith('> ')) {
      out.push(`${QUOTE_FG}▎ ${applyInline(raw.slice(2))}${R}`);
      continue;
    }

    // ── Bullet list ────────────────────────────────────────────────────────
    const bulletMatch = raw.match(/^(\s*)[-*+]\s+(.*)/);
    if (bulletMatch) {
      const indent = Math.floor((bulletMatch[1]?.length ?? 0) / 2);
      const pad = '  '.repeat(indent);
      out.push(`${pad}${BULLET}·${R} ${applyInline(bulletMatch[2]!)}`);
      continue;
    }

    // ── Numbered list ──────────────────────────────────────────────────────
    const numMatch = raw.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (numMatch) {
      const indent = Math.floor((numMatch[1]?.length ?? 0) / 2);
      const pad = '  '.repeat(indent);
      out.push(`${pad}${BULLET}${numMatch[2]}.${R} ${applyInline(numMatch[3]!)}`);
      continue;
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (raw.trim() === '') {
      out.push('');
      continue;
    }

    // ── Normal paragraph text ──────────────────────────────────────────────
    out.push(applyInline(raw));
  }

  // Join with \r\n so xterm renders each line correctly.
  return out.join('\r\n');
}
