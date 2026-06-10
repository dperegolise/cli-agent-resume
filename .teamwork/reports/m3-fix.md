# m3-fix Report

**Branch**: `m3-agent-shell`  
**Commit**: `8e7bca9`  
**Task**: #24 — m3-fix: review-m3 (dead THEME sub, OSC8 link routing, 429 fallthrough) + critic-m3

## Changes Made

### FIX 1 (HIGH) — Dead THEME_CHANGE subscriber (`src/agent/terminal.ts`)

**Problem**: The subscriber cast the event payload to `ThemeChangeEvent & { theme?: ThemeConfig }` and read `evt.theme`, but `ThemeChangeEvent` only has `{ themeName: string }`, so `evt.theme` was always `undefined` and the handler never re-applied the theme to xterm.

**Fix**: Changed the subscriber to check `evt.themeName` and call `toXtermTheme(this.themeManager.getTheme())`. Since the emitter (cmdTheme) already called `themeManager.setTheme()` before emitting, `getTheme()` returns the new theme by the time the subscriber fires. No double-call to `setTheme()`.

**API change**: `AgentTerminal` constructor now takes a second parameter `themeManager: ThemeManager`. `index.ts` updated to pass it.

### FIX 2 (HIGH) — OSC 8 MOTD link clicks (`src/agent/terminal.ts`, `src/index.ts`)

**Problem**: `WebLinksAddon()` was instantiated with no handler, so the default `window.open(url)` was called for all links — including `agent:query:...` URIs, which opened blank browser tabs instead of routing to the SSEClient.

**Fix**: `WebLinksAddon` now receives a custom handler that:
- For `agent:query:` URIs: decodes the query and calls `this.sseClient.sendMessage(query)`
- For all other URIs: falls back to `window.open(uri, '_blank')`

`AgentTerminal` gains:
- `private sseClient?: SSEClient` field
- `setSseClient(client: SSEClient): void` method

`index.ts` calls `terminal.setSseClient(sseClient)` after SSEClient construction.

### FIX 3 (MEDIUM) — HTTP 429 explicit handler (`src/agent/sseClient.ts`)

**Problem**: The old code had `if (!response.ok && response.status !== 429)`, so a 429 response skipped the error handler but then fell through to `streamSSE()` which threw "Response body is null" (the 429 body has no SSE stream), producing an unhelpful stream error message.

**Fix**: Added an explicit 429 handler *before* the `!response.ok` check that:
1. Stores the `X-Client-Banned-Until` header in localStorage (if present)
2. Reads the ban timestamp from localStorage and formats it as human-readable time
3. Writes a user-friendly rate-limit message to the terminal
4. Restores the prompt and returns early

### FIX 4 (LOW) — isStreaming guard on Enter (`src/agent/inputHandler.ts`)

**Problem**: `handleEnter()` always submitted, even if a stream was already in progress, allowing two concurrent SSE streams racing on `this.currentAbortController`.

**Fix**: Added early return at the top of `handleEnter()` if `this.sseClient.isStreaming` is true. `isStreaming` was already a getter on `SSEClient`.

### FIX 5 (MEDIUM) — Fetch timeout (`src/agent/sseClient.ts`)

**Problem**: No timeout was wired to the `AbortController`, so a hanging backend would block the terminal indefinitely (until user Ctrl+C).

**Fix**: Added a 30-second `setTimeout(() => this.currentAbortController?.abort(), 30_000)` before the `fetch()` call. The timeout ID is cleared in a `finally` block that runs whether the fetch succeeds or throws.

### FIX 6 (UX) — Down-arrow no-op when not in history navigation (`src/agent/inputHandler.ts`)

**Problem**: When `historyIndex === -1` (user is typing, not navigating history) and Down is pressed, the code fell into the `else` branch which computed `nextIndex = -1 + 1 = 0`, then navigated to `history[0]`. Pressing Down from the draft should be a no-op.

**Fix**: Added `if (this.historyIndex === -1 && direction === 1) return;` at the top of `navigateHistory()`.

### FIX 7 (LOW) — Tighten VALID_PATH_RE (`src/manifest.ts`, `src/tests/test-path-edge-cases.mjs`)

**Problem**: The old regex `/^[a-z0-9/_-]+\.md$/` allowed leading slashes (`/etc/passwd.md` would pass format check) and empty segments (`a//b.md`, `a/.md`). These were mitigated by the entryIndex whitelist but the regex itself was unnecessarily permissive.

**Fix**: New regex: `/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/`
- Each segment must start with `[a-z0-9]` (no leading slashes, no leading dash/underscore)
- Empty segments between slashes are impossible (each segment requires at least one char)

`src/tests/test-path-edge-cases.mjs` updated from the old hardcoded regex to the new one; all 3 previously-failing edge cases now pass.

## Test Results

All 9 test files pass:

| File | Result |
|---|---|
| `critic-backend-failures.mjs` | 12 passed, 0 failed |
| `critic-focus-item.mjs` | 15 passed, 0 failed |
| `critic-history-bounds.mjs` | 12 passed, 0 failed |
| `critic-motd-injection.mjs` | 24 passed, 0 failed |
| `critic-sse-parsing.mjs` | 14 passed, 0 failed |
| `test-manifest-validation.mjs` | 21 passed, 0 failed |
| `test-path-edge-cases.mjs` | 7 passed, 0 failed (was 3 failing before FIX 7) |
| `test-path-validation.mjs` | 21 passed, 0 failed |
| `test-theme-manager.mjs` | 9 passed, 0 failed |

Build: `npm run build` — 0 TypeScript errors, Vite build successful.

## Interfaces/Contracts Changed

- **`AgentTerminal` constructor**: Now takes `(initialTheme: ThemeConfig, themeManager: ThemeManager)` — callers (currently only `index.ts`) must be updated.
- **`AgentTerminal.setSseClient(client: SSEClient): void`**: New public method — call after SSEClient construction in index.ts.
- `SSEClient.isStreaming` getter: was already public, no change.
- `VALID_PATH_RE` in `manifest.ts`: tightened — any existing paths that relied on the old permissive format (leading slash, empty segments) would now fail `isValidPathFormat()`. All valid real paths remain accepted.
