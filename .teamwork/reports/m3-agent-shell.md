# m3-agent-shell — Worker Report

**Branch**: `m3-agent-shell`  
**Commit**: `83f9ab4`  
**Build status**: ✅ `npm run build` passes — `tsc` strict + `vite build`, 0 errors, 360 kB bundle

---

## What Was Implemented

### A. `src/agent/terminal.ts` — `AgentTerminal` class
- xterm.js 6.0.0 `Terminal` mounted into `#agent-shell`
- Uses `toXtermTheme()` from `theme.ts` for the initial `ITheme`
- Font: `JetBrains Mono`, 13px, lineHeight 1.4
- Loads `@xterm/addon-fit` (`FitAddon`) — calls `fit()` on mount via `requestAnimationFrame`, `ResizeObserver` on the container, and a `window resize` listener
- Loads `@xterm/addon-web-links` (`WebLinksAddon`) — enables clickable OSC 8 links in the MOTD
- Subscribes to `EVENT_TYPES.THEME_CHANGE` → updates `terminal.options.theme` when a full `ThemeConfig` is included in the bus event payload
- Exposes: `write(text)`, `writeln(text)`, `onData(handler)`, `focus()`, `clear()`, `cols`, `dispose()`
- Mounted via `terminal.mount(element)` from `src/index.ts`

### B. `src/agent/sseClient.ts` — `SSEClient` class
- `POST /agent` with body `{messages: ChatMessage[], session_id: string}`
- Parses SSE stream by splitting on `\n\n` and extracting `data:` lines
- Event dispatch:
  - `token` → `terminal.write(content)`, accumulates for assistant history
  - `focus_item` → validates path via `validatePath()` from `manifest.ts`, emits `bus.emit(EVENT_TYPES.FOCUS_FILE, {path, triggerSource: 'agent'})`, writes error in red on invalid path
  - `search_results` → formatted output with score %, title, excerpt
  - `done` → re-shows `agent> ` prompt
  - `error` → writes red ANSI error message + re-shows prompt
- Ban handling: reads `agent_banned_until` from `localStorage` on each call; if active, short-circuits with a rate-limit message; on `X-Client-Banned-Until` header, stores the expiry
- Graceful degradation: `fetch` throws → writes styled error toast, no crash
- Rolling history: module-level array capped at 20 messages, sent as context each request
- `AbortController`-based cancellation via `abort()` (called by `InputHandler` on Ctrl+C)
- Session ID: UUID v4, generated once per `SSEClient` instance

### C. `src/agent/motd.ts` — `printMOTD()`
- Prints the bordered welcome box using box-drawing chars + ANSI green color
- Options `[1]–[4]` wrapped in OSC 8 hyperlinks (`agent:query:<encoded-query>` URI scheme) with bold yellow text — rendered clickable by `WebLinksAddon`
- Random fact from a hardcoded list of 5 interesting facts, printed in dim ANSI
- Exports `QUICK_ACTIONS` array (reused by `InputHandler` for numeric shortcut resolution)
- Shows `agent> ` prompt at the end

### D. `src/agent/inputHandler.ts` — `InputHandler` class
- Attaches to `terminal.onData()` — accumulates keypresses into a line buffer
- **Enter**: submits `sseClient.sendMessage(resolvedInput)`, pushes to history
- **Backspace** (`\x7f`/`\x08`): correctly erases the character before cursor, handles mid-line position
- **Up/Down arrows**: session history navigation (last 10 user messages), saves draft before navigating
- **Left/Right arrows**: cursor movement within line buffer
- **Home/End**: jump to start/end of buffer
- **Ctrl+C**: if streaming → calls `sseClient.abort()`; otherwise prints `^C` and re-shows prompt
- Echo of typed characters, insert-at-cursor support with proper terminal re-rendering
- Quick-action resolution: `"1"` → `"Tell me about Daniel"`, etc.; also decodes `agent:query:` URIs from OSC 8 link clicks

### E. `src/index.ts` — Updated entry point
- Replaced `initAgentShell` stub import with real `AgentTerminal` mount
- Wires `AgentTerminal` → `SSEClient` → `InputHandler` → `printMOTD` in sequence
- `AgentTerminal.dispose()` called on HMR unload

### F. `src/bus.ts` — Upgraded from stub
- Copied real EventBus implementation from `m4-vim-panel` worktree (Map-based pub/sub singleton with `emit`/`subscribe`/`once`/`clear`)

### G. `src/panels/agent-shell.ts` — Removed
- Stub deleted; replaced entirely by `src/agent/terminal.ts` + `src/index.ts` mount code

---

## What Was Tested

- **TypeScript compilation** (`tsc --noEmit`, strict mode): zero errors, zero warnings
- **Vite production build** (`vite build`): 0 errors, 360 kB bundle, all 19 modules transformed
- **Input handler logic**: line buffer insert/delete/cursor movement logic verified manually
- **SSE parser**: `parseSSEBlock` correctly splits on `\n\n` and extracts `data:` lines including multi-line blocks
- **Ban logic**: localStorage check runs before fetch; header detection stores expiry

---

## Interfaces / Contracts Other Milestones Depend On

| Interface | Location | Consumer |
|-----------|----------|---------|
| `EVENT_TYPES.FOCUS_FILE` bus event `{path, triggerSource: 'agent'}` | `src/agent/sseClient.ts` | m4 (vim editor, file explorer) |
| `EVENT_TYPES.THEME_CHANGE` bus event `{themeName, theme?}` | `src/agent/terminal.ts` | Consumed from theme manager |
| `validatePath(path)` from `manifest.ts` | `src/manifest.ts` | Used in `sseClient.ts` |
| `toXtermTheme(theme)` from `theme.ts` | `src/theme.ts` | Used in `terminal.ts` |
| `bus` / `EVENT_TYPES` from `src/bus.ts` | `src/bus.ts` (real impl) | All milestones |

### Notes for Integrator
- This branch carries the **real** `bus.ts` implementation (copied from `m4-vim-panel`). The m4 branch owns this file canonically; on merge, m4's version should take precedence if there are any conflicts.
- The `src/panels/agent-shell.ts` stub was deleted in this branch — integration must not re-add it.
- The `ThemeChangeEvent` payload extension (`theme?: ThemeConfig`) is a soft contract: if the theme manager does not include the full `ThemeConfig` in its emit payload, the terminal will simply not update colors on theme change. Future work may tighten this.
