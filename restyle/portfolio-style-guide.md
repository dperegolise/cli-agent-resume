# Terminal Portfolio — Style Guide

A guide for implementing a developer portfolio that reads as a real working
terminal / Neovim environment rather than a "themed toy." Hand this to the
implementing agent as the source of truth for color, typography, and density.

The governing principle is **restraint**. Prebuilt themes (Tokyo Night,
Dracula, Synthwave) look like toys because of high saturation, decorative
color, tinted backgrounds, and landing-page spacing. A real working terminal
avoids all four. Every rule below exists to preserve that feeling.

---

## 1. Core principles

1. **Color is functional, not decorative.** Roughly 90% of the page is one
   muted off-white. Color appears *only* where it carries meaning: a mode
   indicator, a shell prompt, a diff add/remove, a link, syntax highlighting.
   If a color isn't encoding information, remove it.

2. **Hierarchy comes from brightness, not hue.** Headings and bold text are a
   *brighter off-white* than body text — never a different color. Reserve hue
   changes for semantic meaning only.

3. **Backgrounds are neutral near-black.** No blue, purple, or warm tint. A
   tinted background reads as "designed"; a neutral one reads as "a tool."

4. **Density over breathing room.** Tight line-height, small consistent type,
   information packed in. Generous spacing is landing-page DNA and breaks the
   illusion.

5. **No chrome.** No gradients, glows, drop shadows, rounded decorative boxes,
   or soft borders. Borders are single-weight, flat, 1px. Real TUIs draw boxes
   with one line and nothing else.

6. **Desaturate everything semantic.** Even the "colored" tokens are low-chroma
   — sage instead of neon green, brick instead of crimson, steel instead of
   electric cyan. If you adopt another palette, pull its saturation down 30–40%.

---

## 2. Color palette

Neutral, low-chroma, near-black base. Use these exact values.

| Role | Hex | Usage |
|------|-----|-------|
| `--bg` | `#0e0e10` | Page / pane background. Neutral, barely-there. |
| `--bg-elev` | `#16161a` | Status bars, the one slightly-raised surface. |
| `--bg-chip` | `#1a1a1d` | Inline `code` chip background. |
| `--border` | `#1f1f22` | All dividers and pane separators. Single weight. |
| `--border-box` | `#2a2a2d` | Box outlines (e.g. the agent box). Flat, no radius. |
| `--fg` | `#c8c8c2` | **The workhorse.** ~90% of all text. Muted off-white. |
| `--fg-bright` | `#e2e2dc` | Headings, bold spans. Hierarchy via brightness. |
| `--dim` | `#6b6b6b` | Secondary only: paths, metadata, hints, status text. |
| `--dim-deep` | `#3a3a3c` | Line numbers, gutter. Pushed near-invisible on purpose. |
| `--accent` | `#9aa5b1` | Links and the one quiet accent. Desaturated steel. |
| `--accent-edge` | `#3a4048` | Resting underline under links (hover → `--accent`). |
| `--green` | `#7c9885` | Success / mode indicator / shell user. Muted sage. |
| `--red` | `#b05656` | Deletion / error. Brick, not crimson. |

### Notes on the accent
`--accent` is deliberately *almost gray*. In a real tool even links don't
shout. If the result feels drab rather than serious, nudge the accent toward a
soft desaturated blue (e.g. `#8ba3c4`) — do **not** fix drabness by adding more
colors.

---

## 3. Typography

- **Font:** a single monospace family for the entire UI (e.g. JetBrains Mono,
  IBM Plex Mono, Berkeley Mono, or the system mono stack). One font, period.
- **Base size:** ~12px for body / buffer text; ~11px for the file tree, status
  bars, and metadata. Never go below 11px.
- **Line-height:** ~1.5 for body, ~1.85 for list-dense panes (file tree, nav).
  Keep it tight — this density is doing real work.
- **Weights:** two only — regular (400) and a single bold (500/600). No light
  weights, no black weights.
- **Hierarchy by brightness:**
  - H1 / page title → `--fg-bright`, otherwise same size as body or one notch up.
  - Bold inline (`**text**`) → `--fg-bright`.
  - Body → `--fg`.
  - Everything secondary → `--dim`.
- **Case:** keep things lowercase / sentence case to match terminal convention;
  avoid Title Case and decorative ALL CAPS (a status-bar `NORMAL` token is the
  one acceptable exception because it mirrors Neovim).

---

## 4. Component patterns

### Panes & layout
- Three-pane top region: left sidebar | file tree | editor buffer, then a
  full-width terminal pane below, then a thin status line at the very bottom.
- Separate panes with a 1px `--border` rule. No shadows, no gaps with
  background bleed — panes butt directly against the divider.
- At full screen width let panes breathe horizontally, but keep type size and
  line-height tight. Density ≠ cramped columns.

### Boxes (e.g. the agent box)
- 1px `--border-box` outline, `border-radius: 0`, no fill, no glow.
- Title in `--accent`, version/meta in `--dim`.

### Editor buffer (the markdown preview)
Treat it like a real editor showing syntax-highlighted markdown:
- Gutter line numbers in `--dim-deep` (near-invisible — they should recede hard).
- `# Heading` → `--fg-bright`.
- `**bold**` → `--fg-bright`.
- Links → `--accent` with a `--accent-edge` underline, brightening on hover.
- Inline `code` → `--bg-chip` background, `--accent` text, 3px radius, small padding.
- Body → `--fg`.

### Neovim-style status line
- Left: a mode block — `NORMAL` in dark text (`--bg`) on a `--green` fill,
  `font-weight: 500`, ~2px/8px padding. This is one of the few earned color
  blocks because it encodes mode.
- Then filename + flags (`index.md [RO]`) in `--dim`.
- Right: `markdown · utf-8 · 1:1` in `--dim`.
- Whole bar sits on `--bg-elev` with a top `--border`.

### Terminal pane
- Title line in `--dim`, followed by a 1px `--border` rule.
- Help text in `--fg`, the `~ try:` hint line in `--dim`.
- Prompt: user/host (`visitor@portfolio`) in `--green`, the `:` in `--accent`,
  the `~$` path in `--dim` — mirroring standard shell prompt coloring.
- Blinking block cursor (see below).

### Bottom status line (tmux-style)
- `--bg-elev` background, top `--border`, ~11px `--dim` text.
- Left: repo + branch state (`portfolio master ✓`, the name in `--green`).
- Right: `utf-8 · 100% · 05:17`.

### Blinking cursor
A 6px × 13px `--fg` block, vertical-align ~-2px, `steps(1)` blink ~1.1s:

```css
.cursor {
  display: inline-block;
  width: 6px; height: 13px;
  background: #c8c8c2;
  vertical-align: -2px;
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
```

---

## 5. CSS variables (drop-in)

```css
:root {
  --bg:          #0e0e10;
  --bg-elev:     #16161a;
  --bg-chip:     #1a1a1d;
  --border:      #1f1f22;
  --border-box:  #2a2a2d;
  --fg:          #c8c8c2;
  --fg-bright:   #e2e2dc;
  --dim:         #6b6b6b;
  --dim-deep:    #3a3a3c;
  --accent:      #9aa5b1;
  --accent-edge: #3a4048;
  --green:       #7c9885;
  --red:         #b05656;
}

body { background: var(--bg); color: var(--fg);
       font-family: "JetBrains Mono", ui-monospace, monospace;
       font-size: 12px; line-height: 1.5; }

a { color: var(--accent); text-decoration: none;
    border-bottom: 1px solid var(--accent-edge); }
a:hover { border-bottom-color: var(--accent); }

code { background: var(--bg-chip); color: var(--accent);
       padding: 1px 5px; border-radius: 3px; }
```

---

## 6. Do / don't checklist

**Do**
- Keep ~90% of text in `--fg`; let color mark only semantic things.
- Use brightness (`--fg-bright` vs `--fg` vs `--dim`) for hierarchy.
- Push line numbers and metadata into near-invisible gray.
- Use flat 1px single-weight borders everywhere.
- Keep type tight and dense.

**Don't**
- Don't tint the background (no blue/purple/warm base).
- Don't use saturated or neon colors anywhere.
- Don't add gradients, glows, shadows, or rounded decorative boxes.
- Don't color things just because you can.
- Don't fix "drab" by adding colors — adjust the single accent instead.
- Don't loosen spacing into landing-page territory.
