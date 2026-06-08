# CLI Portfolio Agent

A browser-based developer portfolio that looks and feels like a real terminal. You're
looking at it right now.

**GitHub**: [github.com/danielperegolise/cli-agent-resume](https://github.com/danielperegolise/cli-agent-resume)

---

## What it is

Three panels separated by tmux-style green dividers, all rendered in-browser:

- **Left**: a real xterm.js terminal connected to a streaming LangChain agent. Ask it
  anything about my background or navigate by typing commands.
- **Top-right**: a NERDTree-style file explorer backed by a static manifest generated at
  build time. No runtime filesystem access.
- **Bottom-right**: CodeMirror 6 with Vim keybindings in read-only mode, displaying
  markdown files from `www/`. Full Gruvbox Dark Hard theme with a powerline status bar.
- **Bottom drawer**: a second xterm.js terminal with a command interpreter — `ls`, `view`,
  `search`, `theme`, and friends.

The agent has exactly two tools: `search_portfolio` (full-text search over the markdown
content) and `focus_item` (navigate to a file and highlight it in the explorer + editor).

---

## Why I built it

I wanted a portfolio that felt like dropping into a developer's actual machine rather than
reading a Squarespace page. A terminal aesthetic because that's where I live. An AI agent
because it's a better interface than a nav bar for exploring unstructured content.

The secondary goal was a real exercise in building with xterm.js, CodeMirror 6, and LangChain
together — each of which has interesting API surfaces that aren't well-documented in
combination.

---

## Technical decisions worth noting

**No framework**: Vite + vanilla TypeScript. Zero framework overhead; direct DOM; xterm.js
integrates cleanly without React lifecycle complexity.

**Static manifest at build time**: A Vite plugin scans `www/` and emits `manifest.json` as
a static asset. The frontend fetches it once and caches it; the backend reads it at startup
for the search index. No runtime filesystem access on either end.

**Model cascade**: The agent backend tries OpenRouter → HuggingFace → a local completions
proxy in order. The local proxy (`src/routr`) is text-only and never receives tool
definitions — a constraint that simplifies the fallback path considerably.

**In-memory rate limiter**: Per-IP sliding window, 20 req/60s, 24h ban on breach. No Redis
dependency. Resets on restart, which is acceptable for a personal VPS.

---

## Stack

TypeScript, Vite, xterm.js 6.0, CodeMirror 6 + codemirror-vim, Python, FastAPI, LangChain,
Gruvbox Dark Hard, JetBrains Mono
