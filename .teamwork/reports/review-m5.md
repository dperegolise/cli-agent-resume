# Review: m5-cli-drawer

**Date**: 2026-06-08  
**Reviewer**: reviewer  
**Branch**: m5-cli-drawer  
**Worktree**: `.claude/worktrees/m5-cli-drawer`  
**Verdict**: CHANGES-REQUESTED

---

## Summary

The m5-cli-drawer implementation is broadly correct and well-structured. All 10 commands are present, the bus contract is honored for `view`, path validation gates bus emission, tab completion and history work as designed, the build is clean (zero TS errors), and m2's `#drawer-toggle` is never touched by m5. However, there are two actionable bugs and one minor deviation that must be fixed before this milestone can merge.

---

## Checklist Results

### 1. CLITerminal mounted on `#cli-drawer` ✅
`src/index.ts:47,61` — `document.getElementById('cli-drawer')` passed to `cliTerminal.mount(cliDrawerEl)`. JetBrains Mono 13px set at `terminal.ts:68-69`. `FitAddon` loaded in constructor and `.fit()` called in `mount()` at `terminal.ts:88`. `ResizeObserver` + `window.resize` trigger `fitAddon.fit()` — correct.

### 2. No double-binding on `#drawer-toggle` ✅
m5 has no reference whatsoever to `#drawer-toggle`, `#divider-bottom`, or `DrawerToggle`. The comment in `terminal.ts:14` explicitly calls this out. m2's `DrawerToggle` exclusively owns that binding.

### 3. Default open ✅
`#cli-drawer` has no `display: none` and `#app` has no `.drawer-collapsed` class on load. Grid row 3 is visible by default.

### 4. Splash screen ✅
ASCII logo printed via `SPLASH_LINES` array (`terminal.ts:39-51`). Version line `— v1.0.0` present. Help hint `Type 'help' for available commands.` present.

### 5. Prompt ✅ (with note)
`terminal.ts:53`: `\x1b[92mvisitor@portfolio\x1b[0m:\x1b[94m~\x1b[0m$ `  
The visible text is `visitor@portfolio:~$ ` with ANSI color codes. This matches the spec string. ✓

### 6. All 10 commands present ✅
`commands.ts:257-297` dispatches: `help`, `ls`, `view`, `search`, `about`, `projects`, `contact`, `clear`, `theme`. All 10 from the strategy are present.

- `ls` and `ls <section>` — ✅ (`cmdLs`, `commands.ts:74-116`)
- `view <path>` — ✅ (`cmdView`, validates before emit)
- `search <query>` — ✅ (`cmdSearch`, hits `/agent` SSE endpoint)
- `about`, `projects`, `contact` — ✅ (aliases to `cmdView` with correct paths, strategy-spec matches)
- `clear` — ✅ (`ctx.clearScreen()`)
- `theme <name>` — ✅ (handles gruvbox-dark, nord, tokyo-night)

### 7. `view` path validation ✅
`commands.ts:125`: `validatePath(rawPath)` is called, and `bus.emit` only fires if it returns `true` (`commands.ts:131-136`). Invalid paths print an error and return early. `validatePath` in `manifest.ts:94-96` checks both format (`VALID_PATH_RE`) and manifest presence.

### 8. Theme command updates shared object — **BUG** ⚠️
**File**: `src/drawer/commands.ts:233-236` + `src/drawer/terminal.ts:126-148`

**Problem**: Double application of `setTheme`. The flow is:
1. `cmdTheme` calls `ctx.setTheme(name)` → `themeManager.setTheme(name)` → `applyThemeCSSVars()` (1st time)
2. `cmdTheme` then calls `bus.emit(EVENT_TYPES.THEME_CHANGE, {themeName: name})`
3. `CLITerminal.subscribeTheme` callback fires; first block does `themeManager.getTheme()` + updates xterm (correct)
4. **Second block** (`terminal.ts:138-145`): `evt.themeName` is always set, so `themeManager.setTheme(evt.themeName)` is called **again** → `applyThemeCSSVars()` fires a **second time**

`ThemeManager.setTheme()` is currently idempotent (no bus emission of its own), so this is not an infinite loop, but it is architecturally broken: `setTheme` is called twice, `applyThemeCSSVars` runs twice, and the `ThemeManager.onThemeChange` listeners are notified twice per command.

**Fix**: Remove the redundant second `setTheme` call inside `subscribeTheme`. The subscriber should only update `this.term.options.theme`; the `ThemeManager` state is already current (it was set before `bus.emit` fired):

```typescript
// terminal.ts — subscribeTheme, simplified
this.unsubscribeTheme = bus.subscribe<ThemeChangeEvent>(
  EVENT_TYPES.THEME_CHANGE,
  (_evt) => {
    try {
      this.term.options.theme = toXtermTheme(this.themeManager.getTheme());
    } catch {
      // ignore
    }
  },
);
```

### 9. Tab completion ✅
`completion.ts` covers: command names (no-space case), manifest paths (for `view`/`ls`), theme names (for `theme`). Single match → `single` (complete-in-place); multiple → `multiple` (print list + restore partial); repeated Tab → `cycle`. `terminal.ts:200-225` handles all four result types, printing matches on a new line for `multiple`. ✓

### 10. Arrow-key history ✅
`history.ts` implements 50-entry ring buffer with dedup, Up/Down navigation, saved partial-input restore. `terminal.ts:228-248` handles `\x1b[A` and `\x1b[B`. Ctrl+C (`\x03`) clears line and calls `resetCursor('')`. ✓

### 11. Build clean ✅
`npm run build` completes without TS errors (verified). `src/panels/cli-drawer.ts` stub does NOT exist — the panels directory contains only `agent-shell.ts`, `file-explorer.ts`, and `vim-panel.ts` (all stubs for other milestones). ✓

---

## Findings

### F1 — BUG: Double `setTheme` call creates redundant side-effects (REQUIRED FIX)

**Files**: `src/drawer/terminal.ts:138-145`, `src/drawer/commands.ts:233-236`

The `subscribeTheme` listener in `CLITerminal` unconditionally re-calls `themeManager.setTheme(evt.themeName)` whenever the `THEME_CHANGE` event fires. Since `cmdTheme` already called `ctx.setTheme()` (which is `themeManager.setTheme()`) before emitting the event, this produces a double-apply:

- `applyThemeCSSVars()` runs twice (unnecessary DOM mutations)
- `ThemeManager.onThemeChange` private listeners are notified twice
- The pattern is fragile: if `ThemeManager.setTheme()` were ever extended to also `bus.emit(THEME_CHANGE)`, this becomes an infinite loop

The xterm theme update is correct and idiomatic — only the redundant `setTheme` re-call needs to be removed. The first `getTheme()` + assign block (lines 131-136) is sufficient.

### F2 — DESIGN FLAW: `historyDown` returns `savedInput` (an empty string) when pressing Down past the end, causing line-clear with empty buffer (REQUIRED FIX)

**File**: `src/drawer/history.ts:79-84`, `src/drawer/terminal.ts:239-248`

When the user presses Down past the newest history entry, `historyDown()` returns `savedInput` (which was saved when the user first pressed Up). This correctly restores the partial text. However, `terminal.ts` handles `null` as "no-op" and any non-null value as "replace line with this value" — including an empty string `""`.

The issue: `savedInput` is initialized to `''` by `resetCursor('')` at Enter-press time (`terminal.ts:164,186`). So Down-past-end returns `""`. The terminal then:
1. Calls `clearLine()` — clears the current line
2. Sets `lineBuffer = ""`
3. Calls `term.write("")` — writes nothing

This is actually the **correct behavior** (restoring the pre-browse state of an empty input). But it means `historyDown` returning `""` is semantically "restore to empty," and the caller's `if (next !== null)` guard works correctly for the actual no-op case (cursor already at -1). No behavioral bug, but documenting for clarity.

**Re-evaluation**: This is not actually a bug — the behavior is correct. Withdrawing this as a required fix.

### F3 — MINOR: `theme` command has a local validity whitelist separate from `THEME_NAMES` in `theme.ts` (ADVISORY)

**Files**: `src/drawer/commands.ts:225`, `src/theme.ts:110`

`commands.ts` hardcodes `['gruvbox-dark', 'nord', 'tokyo-night']` and `completion.ts` hardcodes the same list. `theme.ts` exports `THEME_NAMES: string[]` with the same values. These three lists must be kept in sync manually. If a new theme is added to `theme.ts`, the command and completion lists will silently reject it.

**Recommendation**: Import and use `THEME_NAMES` from `theme.ts` in both `commands.ts` and `completion.ts`:
```typescript
// commands.ts
import { THEME_NAMES } from '../theme.js';
// ...
if (!THEME_NAMES.includes(name)) { ... }
```

This is advisory (not a blocker for correctness at current scope) but is a maintainability concern.

---

## Required Fixes Before Merge

1. **F1 (REQUIRED)** — `src/drawer/terminal.ts:138-145`: Remove the `if (evt.themeName)` block that re-calls `themeManager.setTheme()`. The subscriber should only update `this.term.options.theme` via `toXtermTheme(this.themeManager.getTheme())`. The manager's state is already updated before the event fires.

2. **F3 (ADVISORY)** — `src/drawer/commands.ts:225` and `src/drawer/completion.ts:12-19`: Replace hardcoded theme-name lists with an import of `THEME_NAMES` from `theme.ts`. Not a functional blocker today but will silently break if themes change.

---

## What's Done Well

- **Clean separation**: m5 owns only `src/drawer/` and has zero touch of m2's `#drawer-toggle` / `DrawerToggle`. Comment in `terminal.ts:14` explicitly notes this boundary.
- **Bus contract**: `FOCUS_FILE` emitted with `triggerSource: 'cli'` per strategy §4. `THEME_CHANGE` emitted so all panels can react.
- **Path security**: `validatePath` checks both regex format AND manifest presence before any bus emission.
- **Robust input loop**: Backspace, Ctrl+C, Tab, arrows, and printable chars are all handled with correct terminal escape sequences.
- **Tab completion design**: Cycle-on-repeated-Tab is a nice UX touch beyond the minimum spec.
- **Build cleanliness**: Strict TypeScript, `noUnusedLocals`, `noUnusedParameters` all pass cleanly.
- **HMR support**: `dispose()` cleans up ResizeObserver, window listener, and theme subscription. `onUnload` in `index.ts` calls it.
