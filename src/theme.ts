/**
 * src/theme.ts — Theme management
 * Single source of truth for all theme data used by xterm.js instances,
 * CodeMirror, and CSS custom properties.
 */

import type { ThemeConfig, ThemeColors } from './types.js';

// ─── Gruvbox Dark Hard ────────────────────────────────────────────────────────

const gruvboxDarkColors: ThemeColors = {
  bg: '#1d2021',
  fg: '#ebdbb2',
  cursor: '#ebdbb2',
  selection: '#504945',
  ansi: [
    '#282828', // 0  black
    '#cc241d', // 1  red
    '#98971a', // 2  green
    '#d79921', // 3  yellow
    '#458588', // 4  blue
    '#b16286', // 5  magenta
    '#689d6a', // 6  cyan
    '#a89984', // 7  white
    '#928374', // 8  bright-black (gray)
    '#fb4934', // 9  bright-red
    '#b8bb26', // 10 bright-green
    '#fabd2f', // 11 bright-yellow
    '#83a598', // 12 bright-blue
    '#d3869b', // 13 bright-magenta
    '#8ec07c', // 14 bright-cyan
    '#ebdbb2', // 15 bright-white
  ],
};

export const GRUVBOX_DARK: ThemeConfig = {
  name: 'gruvbox-dark',
  colors: gruvboxDarkColors,
};

// ─── Nord ─────────────────────────────────────────────────────────────────────

const nordColors: ThemeColors = {
  bg: '#2e3440',
  fg: '#d8dee9',
  cursor: '#d8dee9',
  selection: '#434c5e',
  ansi: [
    '#3b4252', // 0  black
    '#bf616a', // 1  red
    '#a3be8c', // 2  green
    '#ebcb8b', // 3  yellow
    '#81a1c1', // 4  blue
    '#b48ead', // 5  magenta
    '#88c0d0', // 6  cyan
    '#e5e9f0', // 7  white
    '#4c566a', // 8  bright-black
    '#bf616a', // 9  bright-red
    '#a3be8c', // 10 bright-green
    '#ebcb8b', // 11 bright-yellow
    '#81a1c1', // 12 bright-blue
    '#b48ead', // 13 bright-magenta
    '#8fbcbb', // 14 bright-cyan
    '#eceff4', // 15 bright-white
  ],
};

export const NORD: ThemeConfig = {
  name: 'nord',
  colors: nordColors,
};

// ─── Tokyo Night ──────────────────────────────────────────────────────────────

const tokyoNightColors: ThemeColors = {
  bg: '#1a1b26',
  fg: '#a9b1d6',
  cursor: '#c0caf5',
  selection: '#283457',
  ansi: [
    '#15161e', // 0  black
    '#f7768e', // 1  red
    '#9ece6a', // 2  green
    '#e0af68', // 3  yellow
    '#7aa2f7', // 4  blue
    '#bb9af7', // 5  magenta
    '#7dcfff', // 6  cyan
    '#a9b1d6', // 7  white
    '#414868', // 8  bright-black
    '#f7768e', // 9  bright-red
    '#9ece6a', // 10 bright-green
    '#e0af68', // 11 bright-yellow
    '#7aa2f7', // 12 bright-blue
    '#bb9af7', // 13 bright-magenta
    '#7dcfff', // 14 bright-cyan
    '#c0caf5', // 15 bright-white
  ],
};

export const TOKYO_NIGHT: ThemeConfig = {
  name: 'tokyo-night',
  colors: tokyoNightColors,
};

// ─── Theme registry ───────────────────────────────────────────────────────────

export const THEME_NAMES: string[] = ['gruvbox-dark', 'nord', 'tokyo-night'];

const THEMES: Record<string, ThemeConfig> = {
  'gruvbox-dark': GRUVBOX_DARK,
  'nord': NORD,
  'tokyo-night': TOKYO_NIGHT,
};

// ─── CSS variable application ─────────────────────────────────────────────────

/**
 * Apply a ThemeConfig to the document root as CSS custom properties.
 * This updates all panels that read from CSS variables.
 */
export function applyThemeCSSVars(theme: ThemeConfig): void {
  const root = document.documentElement;
  const c = theme.colors;

  root.style.setProperty('--tmux-green', '#44ff88');
  root.style.setProperty('--bg-main', c.bg);
  root.style.setProperty('--fg-main', c.fg);
  root.style.setProperty('--cursor', c.cursor);
  root.style.setProperty('--selection', c.selection);

  c.ansi.forEach((color, i) => {
    root.style.setProperty(`--ansi-${i}`, color);
  });
}

// ─── xterm.js ITheme object ───────────────────────────────────────────────────

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Convert a ThemeConfig to an xterm.js ITheme object.
 * Used by all three xterm.js terminal instances.
 */
export function toXtermTheme(theme: ThemeConfig): XtermTheme {
  const a = theme.colors.ansi;
  return {
    background: theme.colors.bg,
    foreground: theme.colors.fg,
    cursor: theme.colors.cursor,
    cursorAccent: theme.colors.bg,
    selectionBackground: theme.colors.selection,
    black: a[0],
    red: a[1],
    green: a[2],
    yellow: a[3],
    blue: a[4],
    magenta: a[5],
    cyan: a[6],
    white: a[7],
    brightBlack: a[8],
    brightRed: a[9],
    brightGreen: a[10],
    brightYellow: a[11],
    brightBlue: a[12],
    brightMagenta: a[13],
    brightCyan: a[14],
    brightWhite: a[15],
  };
}

// ─── ThemeManager class ───────────────────────────────────────────────────────

type ThemeChangeCallback = (theme: ThemeConfig) => void;

export class ThemeManager {
  private activeTheme: ThemeConfig;
  private listeners: Set<ThemeChangeCallback> = new Set();

  constructor(initialTheme: string = 'gruvbox-dark') {
    const theme = THEMES[initialTheme];
    if (!theme) {
      throw new Error(`Unknown theme: ${initialTheme}. Available: ${THEME_NAMES.join(', ')}`);
    }
    this.activeTheme = theme;
  }

  getTheme(): ThemeConfig {
    return this.activeTheme;
  }

  setTheme(name: string): void {
    const theme = THEMES[name];
    if (!theme) {
      throw new Error(`Unknown theme: ${name}. Available: ${THEME_NAMES.join(', ')}`);
    }
    this.activeTheme = theme;
    applyThemeCSSVars(theme);
    this.listeners.forEach((cb) => cb(theme));
  }

  /**
   * Subscribe to theme changes.
   * @returns Unsubscribe function.
   */
  onThemeChange(cb: ThemeChangeCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
