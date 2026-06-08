# CLI Portfolio — Intent Document

## Overview

A CLI-aesthetic, browser-based portfolio page for a senior software developer. Every panel
is a real terminal primitive rendered in-browser. The experience should feel like dropping
into a developer's actual machine — not a simulation of one.

---

## Layout

Three panels separated by thin green tmux-style dividers (single-pixel `#00ff00` or the
Gruvbox/Nord "green" of choice — configurable via a single CSS variable).

```
┌──────────────────┬────────────────────────────────────────┐
│                  │  File Explorer (NERDTree-style)        │
│  AI Agent Shell  ├────────────────────────────────────────┤
│  (left sidebar,  │                                        │
│   full height)   │  Vim Editor (read-only)                │
│                  │  Opens .md files from www/             │
│                  │                                        │
├──────────────────┴────────────────────────────────────────┤
│  CLI Drawer (bottom, collapsible)                         │
└───────────────────────────────────────────────────────────┘
```

- Left sidebar: fixed width (~320–360px), full viewport height, non-resizable initially
- Right panel: fills remaining width, split top (file explorer, ~25% height) / bottom (Vim, ~75%)
- Bottom drawer: fixed height (~220px), slides up/down, default open on load
- All dividers: 1px solid, tmux green (`--tmux-green: #44ff88` or similar)

---

## Panel 1 — AI Agent Shell (left sidebar)

### Runtime
- **xterm.js** running entirely in-browser (no server-side pty, no sandboxing required)
- Terminal emulator only; all I/O is handled by a JS shim that speaks to the backend agent API
- Font: JetBrains Mono or Hack Nerd Font (loaded via CDN); size 13px; line-height 1.4

### Agent
- **LangChain** agent loop runs server-side (Python — FastAPI + LangChain)
- Model cascade (in priority order, first available wins):
  1. OpenRouter free-tier models (configurable list in env)
  2. HuggingFace Inference API free models
  3. Custom `src/routr` endpoint — a completions-only, no-tools proxy that normalizes
     responses to the OpenAI completions format; no function-calling passthrough
- Sessions are stateless per-request; conversation history is managed client-side and
  sent as a rolling window of messages
- **Burst protection**: any IP that exceeds N requests/minute (configurable, default 20)
  is immediately killed (SSE/WS closed) and banned for 24 hours; ban list stored in-memory
  (no Redis dependency — single-process VPS deployment)

### Agent tooling (only these two tools, no others)
1. **`search_portfolio(query: string) → [{title, path, excerpt, section}]`**  
   Full-text search over the content of all `www/**/*.md` files; returns ranked results
   with location metadata so the agent can tell the user where things live.
2. **`focus_item(path: string) → void`**  
   Emits a cross-panel event that causes the right-hand Vim panel to open the given file
   and the file explorer to highlight it. The agent calls this when the user wants to
   navigate to a specific page.

### Default state on load
The terminal prints a welcome sequence that mimics a shell motd:

```
  ╭─────────────────────────────────────╮
  │  Hi, I'm [Name]'s portfolio agent.  │
  │  Ask me anything, or try:           │
  │                                     │
  │  [1] About me                       │
  │  [2] Projects                       │
  │  [3] Experience                     │
  │  [4] Contact                        │
  ╰─────────────────────────────────────╯
  agent>
```

Options `[1]`–`[4]` are clickable (xterm.js link decoration) and also typeable. The agent
proactively suggests one interesting thing about the portfolio owner on each load (pulled
from a random fact seeded in the system prompt).

---

## Panel 2 — Right Panel (File Explorer + Vim)

### File Explorer (top ~25%)
- NERDTree-style tree rendered as a **styled DOM tree** (not an xterm.js instance) — lighter,
  more accessible, easier to style with CSS; matches the terminal aesthetic via font + color vars
- Maps 1:1 to `www/` directory structure at build time (static JSON manifest generated
  during build; no runtime filesystem access)
- Keyboard navigation: `j`/`k` to move, `Enter` to open, `o` to open in split (future),
  `?` for help
- Clicking a file focuses it; selected file is highlighted in Gruvbox yellow/orange

### Vim Editor (bottom ~75%)
- **CodeMirror 6** with a Vim keybinding layer (`@replit/codemirror-vim` or `codemirror-vim`)
- Read-only: all insert-mode commands (`i`, `a`, `o`, `s`, `c`, `d`, `p`, etc.) are no-ops
  or show a brief "read-only" flash; `:w`, `:wq`, `:x` are no-ops
- Markdown rendered with syntax highlighting (CodeMirror's markdown grammar + Gruvbox theme)
- Status line at bottom: a full Vim-style powerline status bar rendered as a DOM element
  directly below the editor (not a CodeMirror panel extension). Two-segment design:
  - **Left**: `  NORMAL  ` mode pill (Gruvbox color-coded per mode: green=NORMAL,
    yellow=INSERT blocked flash, cyan=VISUAL) → nerd font separator `` → filename
    with relative path → modified indicator (always `[RO]`)
  - **Right**: file type pill (`markdown`) → `  `` → line:col → percentage through file
  - Separators use powerline glyphs (`` / ``) for the angled chevron look
  - Background color shifts subtly when the agent `focus_item` transition is in progress
- Default file on load: `www/index.md` — displays owner's name, tagline, and key links
- When the agent calls `focus_item(path)` or the CLI executes `view <path>`, the editor
  transitions to that file with a brief fade (no jarring jump)

### www/ content structure (to be populated)
```
www/
├── index.md          ← default; name, tagline, links
├── about.md
├── experience/
│   ├── index.md
│   └── *.md          ← one file per role
├── projects/
│   ├── index.md
│   └── *.md          ← one file per project
└── contact.md
```

---

## Panel 3 — CLI Drawer (bottom)

- xterm.js instance, collapsible via a click on the divider bar or `Ctrl+\`` keybinding
- On load: splash screen with ASCII art logo, version line, and a `help` command output
- Shell prompt style: `visitor@portfolio:~$`
- Commands (initial set):
  | Command | Effect |
  |---------|--------|
  | `help` | list commands |
  | `ls` / `ls <section>` | list top-level pages or pages in a section |
  | `view <path>` | open file in Vim editor, focus file explorer |
  | `search <query>` | search portfolio content, print results |
  | `about` | shortcut for `view about.md` |
  | `projects` | shortcut for `view projects/index.md` |
  | `contact` | shortcut for `view contact.md` |
  | `clear` | clear the CLI terminal |
  | `theme <name>` | switch color theme (gruvbox-dark, nord, tokyo-night) |
- Tab completion for file paths and commands
- Arrow-key history (local, session-scoped)
- Executing any `view` command focuses the same file in the Vim editor (cross-panel event bus)

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend framework | **Vite + vanilla TS** | No framework overhead; direct DOM; easy xterm.js integration |
| Terminal emulator | **xterm.js** | De-facto standard, in-browser, no pty required |
| Vim editor | **CodeMirror 6 + codemirror-vim** | Battle-tested, read-only mode, markdown support |
| Agent backend | **Python FastAPI** | Lightweight, SSE-friendly, runs on any VPS |
| Agent framework | **LangChain (Python)** | Mature tool-calling, easy model swapping |
| Model routing | OpenRouter → HuggingFace → src/routr | Free tier cascade, graceful degradation |
| Build/bundler | **Vite** | Fast HMR, clean static output |
| Deployment | VPS — static files served by nginx/caddy; FastAPI behind same reverse proxy as routr | Single machine, no serverless cold starts, co-located with live routr instance |

### src/routr
A thin proxy server (in this repo) that:
- Accepts `POST /v1/completions` (OpenAI completions format, no `tools` field)
- Routes to a configured HuggingFace or local model
- Returns normalized OpenAI-compatible response
- Used as the final fallback in the model cascade; never receives tool definitions

---

## Deployment Topology (VPS)

```
internet
    │
    ▼
nginx / Caddy (reverse proxy, TLS termination)
    ├── /             → dist/          (Vite static build, served as files)
    ├── /agent        → FastAPI :8001  (SSE streaming, LangChain agent)
    └── /v1           → routr :8000    (existing live routr instance)
```

- **Static assets**: `vite build` output dropped into `/var/www/portfolio/dist`; nginx serves
  with long-lived cache headers on hashed assets, no-cache on `index.html`
- **FastAPI**: run as a systemd service (or docker-compose service), listens on `127.0.0.1:8001`
- **routr**: already running on the same host; portfolio's `src/routr` fallback points to it
  via `localhost`; no additional network hop
- **Process supervision**: systemd unit file at `deploy/portfolio-agent.service` committed
  to this repo; `deploy/README.md` documents the install steps (`systemctl enable --now`)
- **www/ content**: markdown files are baked into the Vite build as a static JSON manifest
  (`/assets/manifest.json`) and as raw text assets; FastAPI also reads them at startup for
  the search index — no separate content sync step needed

---

## Color & Typography

- **Primary theme**: Gruvbox Dark (hard)
- **Accent / dividers**: tmux green (`#b8bb26` Gruvbox yellow-green, or a brighter `#44ff88`)
- **Font**: JetBrains Mono — loaded from Fontsource or Google Fonts CDN; fallback `monospace`
- **Nerd Font icons**: loaded via a Nerd Font patched variant or the `nerd-fonts-symbols` CDN
  subset for tree glyphs (``, ``, ``, ``, ``)
- All three xterm.js instances share a single theme object (background, foreground, cursor,
  selection, 16 ANSI colors) derived from the active theme

---

## Security & Rate Limiting

- No user authentication; all access is anonymous
- IP-based rate limiter on the `/agent` endpoint:
  - Sliding window: 20 requests / 60 seconds per IP
  - On breach: immediately close the response stream, add IP to ban list
  - Ban duration: 24 hours (configurable via env `AGENT_BAN_DURATION_HOURS`)
  - Ban list: in-memory dict with TTL (single-process; resets on server restart, acceptable for VPS)
- No user content is stored; conversation history lives only in the browser session
- Agent system prompt is server-side only; never sent to the client
- `focus_item` paths are validated against the static file manifest before the event is emitted

---

## Open Questions / Decisions Deferred

1. ~~**Vim status line**~~ — resolved: fancy powerline DOM bar (see Panel 2)
2. ~~**Mobile**~~ — resolved: see Mobile section below
3. ~~**Process management on VPS**~~ — resolved: systemd (unit file in `deploy/`)

---

## Mobile Layout (v1 — viewport < 768px)

Desktop three-panel layout collapses to a single-view mobile experience:

- **Default view**: full-screen Vim editor (CodeMirror + vim keybindings), same read-only
  content, same powerline status bar
- **Hamburger menu** (top-right corner, `☰`): slides in a sidebar drawer from the left
  containing the NERDTree-style file explorer; tapping a file closes the drawer and loads
  that file in the editor
- Agent shell and CLI drawer are hidden on mobile (too small to be useful in a terminal)
- The hamburger and sidebar use the same Gruvbox color scheme; sidebar has a semi-transparent
  backdrop overlay

---

## Non-Goals (v1)

- No user accounts, no persistence
- No editable content in the browser
- No full mobile experience — mobile shows Vim + file explorer sidebar only (see Mobile section)
- No i18n
- No analytics beyond server-side request logs
