# Review: m3-agent-shell

**Branch**: `m3-agent-shell`  
**Commit**: `83f9ab4`  
**Verdict**: **CHANGES-REQUESTED**

---

## Summary

The m3-agent-shell milestone delivers a well-structured xterm.js AgentTerminal with correct font/theme setup, a solid SSE client, valid path validation, and good graceful degradation for backend failures. The bus.ts is byte-for-byte identical to m4's authoritative version. However, three design defects require fixes before integration: a dead THEME_CHANGE subscription that will silently never fire, broken OSC 8 link click handling (clicks escape to the browser instead of the terminal), and a 429 response falling through to streamSSE() without user feedback.

---

## Checklist Results

### ✅ Item 1 — AgentTerminal on #agent-shell
`src/agent/terminal.ts` mounts xterm.js into the element passed from `index.ts`, which uses `document.getElementById('agent-shell')`. Font family `"JetBrains Mono"`, fontSize 13, lineHeight 1.4. FitAddon and WebLinksAddon both loaded. **PASS**.

### ❌ Item 2 — THEME_CHANGE subscription (CRITICAL)

**File**: `src/agent/terminal.ts`, lines 68–80.

The terminal subscribes to `EVENT_TYPES.THEME_CHANGE` on the event bus. This subscription **will never fire** because:

1. `ThemeManager` (`src/theme.ts`) has its own private `listeners: Set<ThemeChangeCallback>` and an `onThemeChange(cb)` API. It **does not emit to the global `bus`** at all.
2. Even if something did emit `THEME_CHANGE` to the bus, `ThemeChangeEvent` only carries `{ themeName: string }` per `src/types.ts` line 70. The handler tries to read `evt.theme` (a `ThemeConfig`), which is always `undefined`. The `if (evt.theme)` guard means the terminal option is never set.
3. The worker report acknowledges this as a "soft contract / future work" footnote — but this is dead code, not a soft contract. Theme changes will silently not apply to the terminal.

**Required fix**: Either (a) make `ThemeManager.setTheme()` emit to the bus with the full `ThemeConfig` payload (extend `ThemeChangeEvent` or add a separate payload field), **or** (b) have `index.ts` pass a callback via `themeManager.onThemeChange()` that calls `terminal.setTheme(config)` directly (bypassing the bus). Option (b) is simpler and avoids widening the bus contract unilaterally in m3.

### ✅ Item 3 — SSE request shape
`sseClient.ts` line 118: `POST /agent` with body `{ messages: this.history, session_id: this.sessionId }`. History is a rolling window of last 20 messages. **PASS** (note: strategy §5 says "max ~10 messages" as bandwidth guidance but 20 is a reasonable implementation choice and the contract just says "rolling window").

### ✅ Item 4 — SSE event parsing
All five event types handled correctly:
- `token` → `terminal.write(content)` (lines 253–256)
- `focus_item` → path validation then `bus.emit(FOCUS_FILE)` or red error (lines 259–277)
- `search_results` → formatted output (lines 279–281)
- `done` → re-shows `agent> ` prompt (lines 283–289)
- `error` → red ANSI + prompt (lines 292–298)

**PASS**.

### ✅ Item 5 — focus_item path validation
`validatePath()` from `manifest.ts` is called at line 264 **before** `bus.emit()`. Invalid path prints error to terminal, no bus emission. Path traversal (`../`, absolute `/`, etc.) correctly rejected by regex + manifest index check. Tests in `src/tests/test-path-validation.mjs` cover 15 adversarial cases including null-byte injection, URL-encoding, dotfiles, and spaces. **PASS**.

### ❌ Item 6 — Ban handling (DEFECT)

**File**: `src/agent/sseClient.ts`, lines 144–159.

The `X-Client-Banned-Until` header is correctly stored in localStorage (line 147). However, the error-path guard at line 151 reads:

```typescript
if (!response.ok && response.status !== 429) {
```

This means **HTTP 429 falls through to `streamSSE()`**. A 429 response body is not a valid SSE stream — the backend sends a JSON error body. `streamSSE()` will either get null body or fail to parse JSON as SSE events and silently return with no prompt shown. The ban IS stored in localStorage for future calls, but the current call gives no user feedback (no red error message, no re-shown prompt) until the user happens to press Enter again.

**Required fix**: Handle 429 explicitly — show the ban message and re-show prompt, then `return`. Example:

```typescript
if (response.status === 429) {
  const banUntilStr = localStorage.getItem(BAN_STORAGE_KEY);
  const timeStr = banUntilStr ? new Date(banUntilStr).toLocaleTimeString() : 'later';
  this.terminal.writeln(ANSI_RED + `Rate limit exceeded. Try again after ${timeStr}.` + ANSI_RESET);
  this.terminal.write('\r\nagent> ');
  this.streaming = false;
  this.currentAbortController = null;
  return;
}
```

### ❌ Item 7 — MOTD: OSC 8 link clicking broken (DEFECT)

**Files**: `src/agent/motd.ts` lines 48–63; `src/agent/terminal.ts` lines 8–9, 25; `src/agent/inputHandler.ts` lines 289–293.

The MOTD uses OSC 8 hyperlinks with `agent:query:<encoded>` URIs. The comment at `motd.ts:60` says "the inputHandler watches for the agent: prefix." However:

1. `WebLinksAddon` by default calls `window.open(url)` when a link is clicked — it does **not** pipe the URI into the terminal's `onData` stream.
2. There is no custom link handler registered (no `WebLinksAddon({ handler: ... })` option, no `terminal.registerLinkProvider()`).
3. Clicking `[1] About me` will attempt to open `agent:query:Tell%20me%20about%20Daniel` in a new browser tab, which will fail (unhandled protocol) or show a browser error — not trigger the query.
4. The `resolveInput('agent:query:...')` code path in `inputHandler.ts` is unreachable from click events; it would only activate if someone manually typed `agent:query:...` at the prompt.

The typing shortcuts (`1`, `2`, `3`, `4`) work correctly and provide the intended functionality. The MOTD box renders correctly. But the checklist requirement "clicking/typing triggers correct query" fails on the clicking half.

**Required fix**: Register a custom link handler on WebLinksAddon. The handler should call `sseClient.sendMessage(decodedQuery)` directly:

```typescript
// In terminal.ts constructor or in a new method:
this.webLinksAddon = new WebLinksAddon(undefined, undefined, true);
// OR register a custom link provider:
this.term.registerLinkProvider({
  provideLinks(bufferLineNumber, callback) { ... }
});
```

Alternatively, instantiate `WebLinksAddon` with a custom handler that intercepts `agent:` URIs and routes them to the SSEClient rather than calling `window.open`.

A simpler approach: in `motd.ts`, expose a `setLinkClickHandler(handler)` that `index.ts` wires to `sseClient.sendMessage()`, and pass that handler to `WebLinksAddon` constructor.

### ✅ Item 8 — Input handler

Line buffer accumulation, Enter submission, Backspace (including mid-line), up/down history navigation with draft saving, left/right cursor movement, Home/End keys, Ctrl+C abort or echo. All correctly implemented. History capped at 10 entries. **PASS**.

Minor observation (non-blocking): `handleEnter()` does not guard against submitting while `isStreaming` is true. Two concurrent SSE requests can be created with interleaved terminal output. Ctrl+C aborts only the most recent `AbortController`. Consider adding an early return if `this.sseClient.isStreaming` in `handleEnter()`.

### ✅ Item 9 — Graceful degradation
`fetch` throws (network error) → `terminal.writeln()` with styled error + `agent> ` prompt, no crash. `sseClient.ts` lines 124–141. **PASS**.

### ✅ Item 10 — bus.ts compatibility
`src/bus.ts` is byte-for-byte identical to `m4-vim-panel/src/bus.ts`. All EVENT_TYPES keys/values match. All payload type imports match. The singleton `export const bus = new EventBus()` is identical. **PASS**.

### ✅ Item 11 — Build clean / stub removed
- `src/panels/agent-shell.ts` stub does not exist (correctly removed).
- `src/index.ts` imports `AgentTerminal` from `src/agent/terminal.ts` (line 10).
- `npm run build` reported as passing by the worker (0 tsc errors, 360 kB bundle).
- No default exports found in any new file; all exports are named.

**PASS**.

---

## Issues Summary

| # | Severity | File | Lines | Description |
|---|----------|------|-------|-------------|
| 1 | **High** | `src/agent/terminal.ts` | 68–80 | THEME_CHANGE subscription is dead code — ThemeManager never emits to bus; `evt.theme` always undefined |
| 2 | **Medium** | `src/agent/sseClient.ts` | 151 | HTTP 429 falls through to `streamSSE()`; no user feedback on first ban hit |
| 3 | **High** | `src/agent/motd.ts`, `terminal.ts`, `inputHandler.ts` | motd:62, terminal:25 | OSC 8 link clicks open browser tab via `window.open`, not routed to terminal/SSEClient |
| 4 | Low | `src/agent/inputHandler.ts` | 136 | No `isStreaming` guard on Enter — two concurrent SSE requests possible |

Issues 1 and 3 are blocking: they cause specified checklist behaviors (theme reactivity, clickable options) to silently not work. Issue 2 leaves the terminal in a broken state (stuck, no prompt) on the first banned request. Issue 4 is a robustness concern but non-blocking.
