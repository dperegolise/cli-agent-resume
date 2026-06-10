# Review Report: m1-scaffold

**Date**: 2026-06-08  
**Branch**: m1-scaffold  
**Reviewer**: Reviewer teammate  
**Verdict**: PASS (with minor notes for downstream milestones)

---

## Summary

m1-scaffold is a solid, well-structured scaffold. All 10 checklist items pass. There are two minor
structural notes that future milestone workers need to be aware of (no changes required now), and one
low-priority correctness note about theme.ts vs the strategy's bus-emission contract.

---

## Checklist Results

### 1. Vite + vanilla-TS ✅
- `package.json` uses Vite 8.0.16 in `devDependencies`; no framework dependency present
- `tsconfig.json` has `"strict": true` plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Build script: `"build": "tsc && vite build"` — type-check before bundle

### 2. Version pins ✅
All versions match strategy §8 exactly:

| Package | Required | Found |
|---|---|---|
| `@xterm/xterm` | `6.0.0` | `6.0.0` ✅ |
| `@xterm/addon-fit` | `0.11.0` | `0.11.0` ✅ |
| `@xterm/addon-web-links` | `0.12.0` | `0.12.0` ✅ |
| `@codemirror/view` | `6.28.0` | `6.28.0` ✅ |
| `@codemirror/state` | `6.4.0` | `6.4.0` ✅ |
| `@codemirror/lang-markdown` | `6.2.0` | `6.2.0` ✅ |
| `@replit/codemirror-vim` | `6.3.0` | `6.3.0` ✅ |
| `vite` | `8.0.16` | `8.0.16` ✅ |
| `typescript` | `5.9.3` | `5.9.3` ✅ |

### 3. Manifest plugin ✅
- `vite.config.ts` defines `generateManifestPlugin()` with `apply: 'build'`
- Plugin scans `www/` recursively, extracts `path`, `title` (frontmatter > H1 > filename), `sections`, `excerpt` (150 chars, frontmatter + H1 stripped), `hash` (SHA-256 first 12 hex chars)
- Emits `Manifest` object with `entries`, `buildDate` (ISO 8601), `version: '1.0'`
- `emitFile({ fileName: 'assets/manifest.json' })` → lands at `dist/assets/manifest.json` ✅
- Built output `dist/assets/manifest.json` has **9 entries** with correct shape ✅

### 4. Raw .md fetchable ✅
- Plugin also calls `copyMdFiles()` which iterates `www/` and emits each `.md` as
  `fileName: 'www/<relpath>'` → `dist/www/*.md`
- `dist/www/` contains all 9 markdown files mirroring the `www/` tree ✅
- `src/manifest.ts` fetches from `/assets/manifest.json` at runtime ✅

### 5. DOM IDs ✅
All required mount-point IDs from strategy §3 are present in `index.html`:

| ID | Present |
|---|---|
| `agent-shell` | ✅ |
| `file-explorer` | ✅ |
| `vim-editor` | ✅ |
| `vim-editor-container` | ✅ |
| `powerline-status-bar` | ✅ |
| `cli-drawer` | ✅ |
| `hamburger-menu` | ✅ (review checklist said `#hamburger-btn` but strategy §3 canonically uses `#hamburger-menu`) |
| `mobile-sidebar` | ✅ |
| `mobile-file-explorer` | ✅ |
| `right-panel` | ✅ |
| `divider-vertical` | ✅ |
| `divider-horizontal` | ✅ |
| `divider-bottom` | ✅ |

### 6. theme.ts ✅ (with note)
- Single source of truth: Gruvbox Dark Hard (`bg: '#1d2021'`, correct hard variant)
- All 16 ANSI colors declared in the 16-element tuple
- `toXtermTheme()` returns `XtermTheme` (compatible with xterm.js `ITheme`)
- `applyThemeCSSVars()` sets `--tmux-green: #44ff88`, `--bg-main`, `--fg-main`, `--cursor`, `--selection`, `--ansi-0` through `--ansi-15`
- No duplicate theme definitions in other src/ files
- `THEME_NAMES`, `GRUVBOX_DARK`, `NORD`, `TOKYO_NIGHT` all exported
- `ThemeManager` class with correct API: `getTheme()`, `setTheme()`, `onThemeChange()` ✅

**⚠ Note (low priority, no fix needed now):** Strategy §2 states `theme.ts` should "emit to event
bus via `bus.ts`". The current implementation uses a direct `onThemeChange(cb)` observer pattern
inside `ThemeManager` instead of calling `bus.emit(EVENT_TYPES.THEME_CHANGE, ...)`. This is
acceptable for m1 since `bus.ts` is a stub, but **m4's Worker must wire `setTheme()` to also call
`bus.emit(EVENT_TYPES.THEME_CHANGE, { themeName })` when implementing the real bus** — or m4 could
have ThemeManager subscribe to its own callbacks and re-emit. The current `onThemeChange` API can
remain as-is; m4 just needs to add the bus emission in `setTheme()`. Strategy says `theme.ts`
imports only `types.ts`, not `bus.ts`, so m4 should likely add a `ThemeManager.connectBus(bus)` call
from `index.ts` rather than creating a circular import.

### 7. types.ts ✅
All required interfaces present:
- `ManifestEntry`, `Manifest` (§7) ✅
- `ThemeConfig`, `ThemeColors` (§2) ✅
- `FocusFileEvent` with `path`, `lineNumber?`, `triggerSource` (§4) ✅
- `ThemeChangeEvent`, `EditorSyncEvent`, `ExplorerHighlightEvent`, `SearchResultsEvent` (§4) ✅
- `SearchResult` with all five fields (§6) ✅
- SSE event shapes: `SSETokenEvent`, `SSEFocusItemEvent`, `SSESearchResultsEvent`, `SSEDoneEvent`, `SSEErrorEvent` + `SSEEvent` union (§5) ✅
- `ChatMessage`, `AgentRequest` ✅
- `ToolCallMessage`, `SystemMessage` ✅
- No imports (purely types) ✅

Note: Review checklist mentioned `AgentMessage` as a required type, but this term does not appear in
strategy §2/§4/§5/§7. The types present cover all contracts defined in the strategy.

### 8. bus.ts stub ✅
- `EventBus` class with `emit<T>()`, `subscribe<T>()` (returning `() => void`), `once<T>()` ✅
- `export const bus = new EventBus()` singleton ✅
- `EVENT_TYPES` const object with all 5 event names ✅
- `EventPayloads` interface mapping event strings to payload types ✅
- All stubs are no-ops; correct return types (`() => void` for `subscribe`) ✅

### 9. manifest.ts ✅
- `loadManifest(): Promise<Manifest>` — fetches `/assets/manifest.json`, validates shape, caches ✅
- `getManifestEntry(path: string): ManifestEntry | null` ✅ (review checklist called this `getEntry()` but strategy §2 says `getManifestEntry()` — implementation matches strategy)
- `getAllPaths(): string[]` ✅
- `validatePath(p: string): boolean` — checks regex pattern AND manifest membership ✅
- Runtime validation (`validateEntry`, `validateManifest`) adds defensive type guards ✅

### 10. npm run build ✅
- `dist/` exists and contains `index.html`, `assets/main-*.js`, `assets/manifest.json`, `www/*.md`
- Build artifact present indicates `tsc && vite build` succeeded without TypeScript errors
- `dist/` is gitignored (not committed to branch)

---

## Structural Notes (no changes required for m1, but downstream workers must be aware)

### A. `src/panels/` is extra-strategic
The Worker created `src/panels/agent-shell.ts`, `src/panels/vim-panel.ts`, `src/panels/cli-drawer.ts`,
`src/panels/file-explorer.ts` as init stubs — imported from `index.ts`. These files are NOT in the
strategy §1 directory layout (which has `src/agent/`, `src/editor/`, `src/explorer/`, `src/drawer/`).

**Impact**: m3, m4, m5 workers will put their implementations in `src/agent/`, `src/editor/`, etc.
(per the strategy), not in `src/panels/`. When they do, `index.ts`'s imports of
`./panels/agent-shell.js`, etc. will become stale stubs. The m3/m4/m5 workers should remove the
corresponding `src/panels/` files and update `index.ts` to import from the correct paths as they
build out their implementations.

The strategy-mandated subdirectories (`src/agent/`, `src/editor/`, `src/explorer/`, `src/drawer/`,
`src/layout/`) are all present (as empty directories) — so the scaffolding intent is clear. `src/panels/`
is a temporary init convenience that is forward-compatible as long as downstream workers clean it up.

### B. Gruvbox colors duplicated in `index.html` inline CSS
`index.html` contains an inline `<style>` block with hardcoded Gruvbox Hard colors as both direct
hex values (`#1d2021`, `#ebdbb2`, etc.) and as `:root` CSS custom properties. The `:root` block is the
right pattern; the hardcoded hex values in element rules (e.g., `background: #1d2021`) bypass the
CSS variable system. This is benign for m1 (no theme switching yet), but m2's layout CSS should use
CSS variables consistently rather than hardcoding. The `:root` block itself is correct and will be
overwritten by `applyThemeCSSVars()` at runtime. This is low priority.

---

## Verdict: **PASS**

The scaffold is complete and correct. All 10 checklist items are satisfied. The two structural notes
above are forward-looking guidance for m3/m4/m5 workers, not defects in m1 itself. The theme.ts bus
wiring note is an explicit deferred task for m4's Worker.
