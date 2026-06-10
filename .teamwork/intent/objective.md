# Objective: CLI Portfolio Site

## Goal
Build a fully functional, browser-based CLI-aesthetic portfolio page for a senior software
developer. The experience should feel like dropping into a real developer's machine. Every
interactive element is a genuine terminal primitive rendered in-browser.

## Layout (three panels, 1px tmux-green dividers)
```
┌──────────────────┬────────────────────────────────────────┐
│                  │  File Explorer (NERDTree DOM tree)     │
│  AI Agent Shell  ├────────────────────────────────────────┤
│  (left sidebar,  │                                        │
│   full height)   │  Vim Editor (CodeMirror 6, read-only)  │
│                  │  + fancy powerline status bar          │
│                  │                                        │
├──────────────────┴────────────────────────────────────────┤
│  CLI Drawer (bottom, collapsible)                         │
└───────────────────────────────────────────────────────────┘
```

## Success Criteria
1. **Agent shell** (xterm.js, left sidebar): LangChain agent streams responses via SSE;
   welcome motd with clickable options on load; agent has exactly two tools:
   `search_portfolio` and `focus_item`.
2. **File explorer** (DOM tree, top-right): maps to `www/` directory; keyboard nav (j/k/Enter);
   click or navigate to open file in Vim panel.
3. **Vim editor** (CodeMirror 6 + codemirror-vim, bottom-right): read-only; markdown syntax
   highlighting; Gruvbox theme; default file `www/index.md`; fancy powerline status bar
   (mode pill, nerd font chevron separators, filetype, line:col, scroll %).
4. **CLI drawer** (xterm.js, bottom): collapsible; splash screen on load; `view`, `ls`,
   `search`, `theme`, `help`, `clear` commands; `view <path>` syncs Vim editor.
5. **Cross-panel event bus**: `focus_item` from agent and `view` from CLI both update the
   Vim editor and file explorer selection simultaneously.
6. **Backend** (Python FastAPI): SSE streaming agent endpoint at `/agent`; LangChain agent
   with model cascade (OpenRouter free → HuggingFace → src/routr completions proxy); IP
   rate limiting (20 req/60s sliding window) with immediate ban on burst (in-memory, 24h TTL).
7. **src/routr**: thin completions-only proxy (OpenAI format, no tools) that normalizes
   responses; used as final fallback in cascade.
8. **Build**: Vite + TypeScript frontend; `vite build` produces `dist/`; static JSON manifest
   of `www/` baked at build time; FastAPI reads `www/` at startup for search index.
9. **Deployment**: systemd unit at `deploy/portfolio-agent.service`; nginx reverse proxy config
   at `deploy/nginx.conf`; `deploy/README.md` with install steps.
10. **Mobile** (< 768px): Vim editor fills screen; hamburger `☰` opens left-side drawer with
    file explorer; agent and CLI drawer hidden.

## Hard Constraints
- xterm.js runs **strictly in-browser** — no server-side pty, no sandboxing
- Agent tools are **exactly two**: `search_portfolio` and `focus_item` — no others
- Model cascade must **never** send tool definitions to `src/routr`
- All three xterm.js instances share a **single theme object** (one source of truth)
- `focus_item` paths are **validated against the static manifest** before emitting
- No user content stored; conversation history in browser session only
- System prompt stays **server-side only**

## Tech Stack (decided)
- Frontend: Vite + TypeScript (vanilla, no framework)
- Terminal emulator: xterm.js (in-browser only)
- Vim editor: CodeMirror 6 + codemirror-vim
- File explorer: styled DOM tree
- Backend: Python FastAPI + LangChain
- Model routing: OpenRouter → HuggingFace → src/routr
- Deployment: VPS, systemd, nginx reverse proxy

## Color & Typography
- Primary theme: Gruvbox Dark (hard)
- Dividers: 1px `#44ff88` (tmux green)
- Font: JetBrains Mono (CDN); Nerd Font symbols subset for tree/powerline glyphs
- All xterm.js instances share one theme object

## Out of Scope (v1)
- User authentication / accounts
- Editable content in browser
- i18n
- Analytics
- Full mobile experience (mobile shows Vim + hamburger file explorer only)
