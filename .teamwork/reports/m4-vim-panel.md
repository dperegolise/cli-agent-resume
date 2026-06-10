# Milestone Report: m4-vim-panel

**Branch**: `m4-vim-panel`  
**Date**: 2026-06-08  
**Status**: DONE  

---

## What Was Implemented

### A. `src/bus.ts` — Real EventBus (replaced stub)

- `EventBus` class using `Map<string, Set<HandlerFn>>` internally
- `emit<T>(eventType, payload)`: iterates a snapshot of handlers (safe re-entrant unsubscription)
- `subscribe<T>(eventType, callback): () => void`: returns an unsubscribe function
- `once<T>(eventType, callback)`: auto-unsubscribes after first emission
- `clear(eventType?)`: removes all listeners for a type or all types (for HMR cleanup)
- `EVENT_TYPES` constants preserved exactly from strategy §4:
  - `FOCUS_FILE: 'focus:file'`
  - `THEME_CHANGE: 'theme:change'`
  - `EDITOR_SYNC: 'editor:sync'`
  - `EXPLORER_HIGHLIGHT: 'explorer:highlight'`
  - `SEARCH_RESULTS: 'search:results'`
- Global `bus` singleton exported

### B. `src/editor/fileLoader.ts`

- `loadFile(path): Promise<string>`: ensures manifest is loaded, validates path via `getManifestEntry()`, fetches from `/www/{path}` with `/assets/www/{path}` fallback, caches results
- `getDefaultFile(): Promise<string>`: loads `index.md` as the default content

### C. `src/editor/vim.ts` — CodeMirror 6 + codemirror-vim, read-only

- `VimEditor` class: `create(element, statusBarEl)`, `loadAndDisplayFile(path, lineNum?)`, `getState()`, `isReadOnly()`, `destroy()`
- Extensions: `vim({ status: false })`, `markdown()`, `gruvboxTheme`, `EditorState.readOnly.of(true)`, `EditorView.lineWrapping`, `powerlineBarExtension`
- Gruvbox dark theme applied via `EditorView.theme()`
- Insert-mode keys (i, a, o, s, c, d, p, r, x, I, A, O, S, C, R, D, P, X) mapped to `<Nop>`
- Ex commands `:w`, `:wq`, `:x`, `:xit` overridden to no-ops via `Vim.defineEx()`
- Read-only toast notification on edit key press (fades after 2s)
- Subscribes to `EVENT_TYPES.FOCUS_FILE` bus events → `loadAndDisplayFile(path)`
- Fade transition on file load (opacity 0.4 → 1.0 with 150ms ease)
- Default file `index.md` loaded on init

### D. `src/editor/statusBar.ts` — Powerline DOM bar

- `PowerlineBar` class: `update()`, `updateFromView()`, `setFile()`, `setLoading()`
- `powerlineBarExtension(bar)`: returns `EditorView.updateListener` extension
- DOM structure per strategy §11:
  - Left: mode pill + `` (powerline right) + filepath + `[RO]`
  - Right: filetype + `` (powerline left) + line:col + scroll%
- Mode colors (Gruvbox): NORMAL=`#b8bb26` (green), INSERT=`#fabd2f` (yellow) with flash animation, VISUAL=`#8ec07c` (cyan)
- Background shifts to `--ansi-8` during loading transitions
- Scroll label: "Top" at 0%, "Bot" at 100%, otherwise "X%"
- CSS injected once into `<head>` via a style element

### E. `src/explorer/tree.ts` — NERDTree DOM tree

- `FileExplorer` class: `render(element, manifest)`, `buildTreeDOM(manifest)`, `highlight(path)`, `getSelectedPath()`, `destroy()`
- Nerd Font icons: `` (closed dir), `` (open dir), `` (markdown), `` (generic file)
- Tree is sorted: directories first, then files, alphabetically within each type
- Click on file → `bus.emit(FOCUS_FILE, { path, triggerSource: 'explorer' })`
- Directory click → toggle expand/collapse with animation
- j/k keyboard navigation (move selection up/down through visible items only)
- Enter → open selected file via FOCUS_FILE emission
- `?` key → help overlay with keybinding reference
- Selected item highlighted with Gruvbox `#d79921` (yellow/orange) background
- Subscribes to `FOCUS_FILE` and `EXPLORER_HIGHLIGHT` bus events → `highlight(path)`
- CSS injected once via `<head>`

### F. `src/explorer/treeNav.ts` — Keyboard navigation

- `TreeNavigator` class: `attach(treeElement)`, `detach()`, `moveCursor('up'|'down')`, `selectCurrent()`
- `attach()` registers a `keydown` listener; `detach()` removes it
- `refreshItems()` rebuilds the flat item list from visible `[data-path]` elements, filtering out items inside `.collapsed` containers
- Delegates focus selection via `bus.emit(FOCUS_FILE, ...)` — no direct DOM mutation outside of `selected` class toggling

### G. `src/index.ts` updates — theme↔bus wiring + panel stub cleanup

- `connectThemeToBus()`: bridges `ThemeManager.onThemeChange(cb)` → `bus.emit(EVENT_TYPES.THEME_CHANGE, { themeName })`.
  Theme.ts stays import-isolated from bus.ts per strategy §2; bridge is in index.ts.
- `bus.clear()` called in `onUnload()` so HMR cycles don't accumulate stale handlers.
- Imports `initVimEditor` from `./editor/vim.js` and `initFileExplorerPanel` from `./explorer/tree.js` directly.
- Removed `src/panels/vim-panel.ts` and `src/panels/file-explorer.ts` (replaced by real modules).
- `src/panels/agent-shell.ts` and `src/panels/cli-drawer.ts` retained as stubs for m3/m5.

---

## Testing

```bash
npm run build
# Output:
# ✓ 40 modules transformed (2 removed panel stubs)
# ✓ tsc passed with 0 errors
# ✓ dist/assets/manifest.json (9 entries)
# ✓ dist/www/*.md files emitted
# ✓ main bundle: 715.52 kB (241.97 kB gzip)
```

- TypeScript strict mode passes with 0 errors (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- Vite build passes in 270ms
- Confirmed: no circular import between `theme.ts` and `bus.ts`

---

## Interfaces / Contracts for Other Milestones

### bus.ts — consumed by m3 and m5

```typescript
import { bus, EVENT_TYPES } from './bus.js';

// m3 (agent shell) emits:
bus.emit(EVENT_TYPES.FOCUS_FILE, { path: 'projects/foo.md', triggerSource: 'agent' });
bus.emit(EVENT_TYPES.THEME_CHANGE, { themeName: 'nord' });

// m5 (CLI drawer) emits:
bus.emit(EVENT_TYPES.FOCUS_FILE, { path: 'about.md', triggerSource: 'cli' });
bus.emit(EVENT_TYPES.SEARCH_RESULTS, { query: 'ml', results: [...] });

// Subscribe (returns unsubscribe fn):
const unsub = bus.subscribe(EVENT_TYPES.FOCUS_FILE, (e) => { ... });
unsub(); // to clean up
```

### EVENT_TYPES (exact values, must not change):
| Constant | Value |
|---|---|
| `FOCUS_FILE` | `'focus:file'` |
| `THEME_CHANGE` | `'theme:change'` |
| `EDITOR_SYNC` | `'editor:sync'` |
| `EXPLORER_HIGHLIGHT` | `'explorer:highlight'` |
| `SEARCH_RESULTS` | `'search:results'` |

### FocusFileEvent payload:
```typescript
{ path: string; lineNumber?: number; triggerSource: 'agent' | 'cli' | 'explorer' }
```

---

## Known Issues / Deferred

- Large chunk warning (715kB): expected for a monolithic frontend; code-splitting is deferred
- Vim mode detection in statusBar uses `getCM()` from codemirror-vim to access CM5 shim state; tested to work with codemirror-vim 6.3.0
- Insert mode keys show toast but don't prevent ALL potential CM state mutations (read-only extension handles that at the CM level)
- Mobile layout integration deferred to m2 (hamburger menu, responsive breakpoints)
