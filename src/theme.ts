/**
 * src/theme.ts — Theme management
 * Single source of truth for all theme data used by xterm.js instances,
 * CodeMirror, and CSS custom properties.
 */

import type { ThemeConfig, ThemeColors } from './types.js';

// ─── Default ─────────────────────────────────────────────────────────────────
// "Restrained terminal" (restyle/portfolio-style-guide.md): neutral near-black
// base, one muted off-white for ~90% of text, hierarchy via brightness, and
// low-chroma semantic colors only. Color is functional, never decorative.

const defaultColors: ThemeColors = {
  bg: '#0e0e10',
  fg: '#c8c8c2',
  cursor: '#c8c8c2',
  selection: '#2a2a2d',
  ansi: [
    '#16161a', // 0  black    — elevated surfaces (status bars, chips)
    '#b05656', // 1  red      — brick, not crimson
    '#7c9885', // 2  green    — muted sage
    '#a89868', // 3  yellow   — dry ochre
    '#8ba3c4', // 4  blue     — soft desaturated steel-blue
    '#a08ca8', // 5  magenta  — muted mauve
    '#9aa5b1', // 6  cyan     — desaturated steel (the accent)
    '#c8c8c2', // 7  white    — the workhorse off-white
    '#6b6b6b', // 8  bright-black — secondary text, paths, metadata
    '#c46a6a', // 9  bright-red
    '#8fae98', // 10 bright-green
    '#bcab76', // 11 bright-yellow
    '#9fb4d1', // 12 bright-blue
    '#b3a0ba', // 13 bright-magenta
    '#aeb9c5', // 14 bright-cyan
    '#e2e2dc', // 15 bright-white — headings/bold (hierarchy via brightness)
  ],
  accentColor: '#9aa5b1',  // desaturated steel — the one quiet accent
  dividerColor: '#1f1f22', // flat 1px pane separators, near-invisible
};

export const DEFAULT: ThemeConfig = {
  name: 'default',
  colors: defaultColors,
};

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
  accentColor: '#44ff88', // bright green — the classic tmux divider color
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
  accentColor: '#88c0d0', // Nord cyan/ice-blue — the signature Nord accent
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
  accentColor: '#7aa2f7', // Tokyo Night blue — the primary UI accent
};

export const TOKYO_NIGHT: ThemeConfig = {
  name: 'tokyo-night',
  colors: tokyoNightColors,
};

// ─── Solarized Dark ───────────────────────────────────────────────────────────

const solarizedDarkColors: ThemeColors = {
  bg: '#002b36',
  fg: '#839496',
  cursor: '#839496',
  selection: '#073642',
  ansi: [
    '#073642', // 0  black
    '#dc322f', // 1  red
    '#859900', // 2  green
    '#b58900', // 3  yellow
    '#268bd2', // 4  blue
    '#d33682', // 5  magenta
    '#2aa198', // 6  cyan
    '#eee8d5', // 7  white
    '#002b36', // 8  bright-black
    '#cb4b16', // 9  bright-red
    '#586e75', // 10 bright-green
    '#657b83', // 11 bright-yellow
    '#839496', // 12 bright-blue
    '#6c71c4', // 13 bright-magenta
    '#93a1a1', // 14 bright-cyan
    '#fdf6e3', // 15 bright-white
  ],
  accentColor: '#2aa198', // solarized cyan — the signature accent
};

export const SOLARIZED_DARK: ThemeConfig = {
  name: 'solarized-dark',
  colors: solarizedDarkColors,
};

// ─── Dracula ──────────────────────────────────────────────────────────────────

const draculaColors: ThemeColors = {
  bg: '#282a36',
  fg: '#f8f8f2',
  cursor: '#f8f8f2',
  selection: '#44475a',
  ansi: [
    '#21222c', // 0  black
    '#ff5555', // 1  red
    '#50fa7b', // 2  green
    '#f1fa8c', // 3  yellow
    '#bd93f9', // 4  blue
    '#ff79c6', // 5  magenta
    '#8be9fd', // 6  cyan
    '#f8f8f2', // 7  white
    '#6272a4', // 8  bright-black
    '#ff6e6e', // 9  bright-red
    '#69ff94', // 10 bright-green
    '#ffffa5', // 11 bright-yellow
    '#d6acff', // 12 bright-blue
    '#ff92df', // 13 bright-magenta
    '#a4ffff', // 14 bright-cyan
    '#ffffff', // 15 bright-white
  ],
  accentColor: '#bd93f9', // dracula purple — the signature accent
};

export const DRACULA: ThemeConfig = {
  name: 'dracula',
  colors: draculaColors,
};

// ─── GitHub Dark ─────────────────────────────────────────────────────────────

const githubDarkColors: ThemeColors = {
  bg: '#0d1117',
  fg: '#c9d1d9',
  cursor: '#c9d1d9',
  selection: '#388bfd40',
  ansi: [
    '#484f58', // 0  black
    '#ff7b72', // 1  red
    '#3fb950', // 2  green
    '#d29922', // 3  yellow
    '#58a6ff', // 4  blue
    '#bc8cff', // 5  magenta
    '#39c5cf', // 6  cyan
    '#b1bac4', // 7  white
    '#6e7681', // 8  bright-black
    '#ffa198', // 9  bright-red
    '#56d364', // 10 bright-green
    '#e3b341', // 11 bright-yellow
    '#79c0ff', // 12 bright-blue
    '#d2a8ff', // 13 bright-magenta
    '#56d4dd', // 14 bright-cyan
    '#cdd9e5', // 15 bright-white
  ],
  accentColor: '#58a6ff', // GitHub blue
};

export const GITHUB_DARK: ThemeConfig = {
  name: 'github',
  colors: githubDarkColors,
};

// ─── Ubuntu ───────────────────────────────────────────────────────────────────

const ubuntuColors: ThemeColors = {
  bg: '#300a24',
  fg: '#ffffff',
  cursor: '#ffffff',
  selection: '#ffffff40',
  ansi: [
    '#2e3436', // 0  black
    '#cc0000', // 1  red
    '#4e9a06', // 2  green
    '#c4a000', // 3  yellow
    '#3465a4', // 4  blue
    '#75507b', // 5  magenta
    '#06989a', // 6  cyan
    '#d3d7cf', // 7  white
    '#555753', // 8  bright-black
    '#ef2929', // 9  bright-red
    '#8ae234', // 10 bright-green
    '#fce94f', // 11 bright-yellow
    '#729fcf', // 12 bright-blue
    '#ad7fa8', // 13 bright-magenta
    '#34e2e2', // 14 bright-cyan
    '#eeeeec', // 15 bright-white
  ],
  accentColor: '#e95420', // Ubuntu orange
};

export const UBUNTU: ThemeConfig = {
  name: 'ubuntu',
  colors: ubuntuColors,
};

// ─── JetBrains Darcula ────────────────────────────────────────────────────────

const jetbrainsColors: ThemeColors = {
  bg: '#1e1f22',
  fg: '#bcbec4',
  cursor: '#bcbec4',
  selection: '#214283',
  ansi: [
    '#25262b', // 0  black
    '#f75464', // 1  red
    '#57965c', // 2  green
    '#d4a849', // 3  yellow
    '#3592c4', // 4  blue
    '#b35eda', // 5  magenta
    '#37a6a6', // 6  cyan
    '#bcbec4', // 7  white
    '#495057', // 8  bright-black
    '#ff8080', // 9  bright-red
    '#73c97b', // 10 bright-green
    '#ffc66d', // 11 bright-yellow
    '#6ab0d8', // 12 bright-blue
    '#c77ddb', // 13 bright-magenta
    '#5dbdbd', // 14 bright-cyan
    '#d4d5db', // 15 bright-white
  ],
  accentColor: '#ffc66d', // JetBrains signature amber/yellow
};

export const JETBRAINS: ThemeConfig = {
  name: 'jetbrains',
  colors: jetbrainsColors,
};

// ─── VS Code Dark+ ────────────────────────────────────────────────────────────

const vscodeColors: ThemeColors = {
  bg: '#1e1e1e',
  fg: '#d4d4d4',
  cursor: '#aeafad',
  selection: '#264f78',
  ansi: [
    '#000000', // 0  black
    '#cd3131', // 1  red
    '#0dbc79', // 2  green
    '#e5e510', // 3  yellow
    '#2472c8', // 4  blue
    '#bc3fbc', // 5  magenta
    '#11a8cd', // 6  cyan
    '#e5e5e5', // 7  white
    '#666666', // 8  bright-black
    '#f14c4c', // 9  bright-red
    '#23d18b', // 10 bright-green
    '#f5f543', // 11 bright-yellow
    '#3b8eea', // 12 bright-blue
    '#d670d6', // 13 bright-magenta
    '#29b8db', // 14 bright-cyan
    '#e5e5e5', // 15 bright-white
  ],
  accentColor: '#007acc', // VS Code blue
};

export const VSCODE: ThemeConfig = {
  name: 'vscode',
  colors: vscodeColors,
};

// ─── Theme registry ───────────────────────────────────────────────────────────

export const THEME_NAMES: string[] = [
  'default',
  'gruvbox-dark', 'nord', 'tokyo-night', 'solarized-dark',
  'dracula', 'github', 'ubuntu', 'jetbrains', 'vscode',
];

const THEMES: Record<string, ThemeConfig> = {
  'default': DEFAULT,
  'gruvbox-dark': GRUVBOX_DARK,
  'nord': NORD,
  'tokyo-night': TOKYO_NIGHT,
  'solarized-dark': SOLARIZED_DARK,
  'dracula': DRACULA,
  'github': GITHUB_DARK,
  'ubuntu': UBUNTU,
  'jetbrains': JETBRAINS,
  'vscode': VSCODE,
};

// ─── CSS variable application ─────────────────────────────────────────────────

/**
 * Apply a ThemeConfig to the document root as CSS custom properties.
 * This updates all panels that read from CSS variables.
 */
export function applyThemeCSSVars(theme: ThemeConfig): void {
  const root = document.documentElement;
  const c = theme.colors;

  root.style.setProperty('--tmux-green', c.accentColor);
  root.style.setProperty('--bg-main', c.bg);
  root.style.setProperty('--fg-main', c.fg);
  root.style.setProperty('--cursor', c.cursor);
  root.style.setProperty('--selection', c.selection);

  // Semantic UI variables (style-guide roles), derived per theme:
  // dividers fall back to the accent so legacy themes keep their tmux line.
  root.style.setProperty('--divider', c.dividerColor ?? c.accentColor);
  root.style.setProperty('--accent', c.accentColor);
  root.style.setProperty('--accent-edge', `color-mix(in srgb, ${c.accentColor} 35%, ${c.bg})`);
  root.style.setProperty('--bg-elev', c.ansi[0]);
  root.style.setProperty('--bg-chip', c.ansi[0]);
  root.style.setProperty('--border', `color-mix(in srgb, ${c.fg} 10%, ${c.bg})`);
  root.style.setProperty('--dim', c.ansi[8]);
  root.style.setProperty('--dim-deep', `color-mix(in srgb, ${c.ansi[8]} 50%, ${c.bg})`);
  root.style.setProperty('--fg-bright', c.ansi[15]);

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

  constructor(initialTheme: string = 'default') {
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
