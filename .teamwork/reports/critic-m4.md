# Critic Report — m4-vim-panel

**Critic:** adversarial testing role  
**Branch:** `m4-vim-panel`  
**Worktree:** `.claude/worktrees/m4-vim-panel/`  
**Test file:** `tests/critic-m4.test.ts` (98 tests, vitest + jsdom)  
**Run result:** 98 passed, 0 failures  
**Date:** 2026-06-08

---

## Executive Summary

Ran 98 adversarial tests across all six critical areas. The implementation is
robust in the places that matter most (path injection, event bus lifecycle, XSS).
Six findings were identified, ranging from minor (NaN in status bar) to
documentation-worthy (belt-and-suspenders gaps in vim key blocking). **No
exploitable security vulnerabilities found.** The security model's key insight
is defence-in-depth: `EditorState.readOnly.of(true)` is the strong last-resort
guard even when vim keymaps are incomplete.

---

## Findings

### VULNERABILITY (Low): NaN propagates through scrollPct clamp

**File:** `src/editor/statusBar.ts` line 262  
**Test:** `PowerlineBar XSS hardening > VULNERABILITY: scrollPct clamp does NOT protect against NaN`

```typescript
// Current (buggy):
scrollPct = Math.max(0, Math.min(100, scrollPct));
// Math.max(0, NaN) === NaN — not clamped to 0
```

If `visibleRanges[0].from` is NaN (possible in degraded DOM states), `scrollPct`
becomes NaN, which passes through the `Math.max/min` clamp unchanged.  
The rendered label would be `"NaN%"` rather than a valid scroll percentage.

**Fix:**
```typescript
scrollPct = Math.max(0, Math.min(100, scrollPct)) || 0;
```

---

### FINDING (Informational): Regex permits `a/.md` and `a//b.md`

**File:** `src/manifest.ts` — `VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/`  
**Tests:** `FINDING: regex accepts "a/.md"`, `FINDING: regex accepts "a//b.md"`

The `+` quantifier on the character class `[a-z0-9/_-]` allows the regex to
match paths with hidden-style filenames (`a/.md`, where there's no stem before
the dot) and consecutive slashes (`a//b.md`).

**Risk:** Low. No malicious path exploitation is possible because the manifest
entry-index check (`entryIndex.has(p)`) acts as a second gate — the manifest
is built from the filesystem and will never contain such paths. However, the
regex could be tightened for correctness:

```typescript
// Stricter: each path segment must contain at least one non-slash char
const VALID_PATH_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/;
```

---

### FINDING (Informational): `validateEntry` does not check path format

**File:** `src/manifest.ts` — `validateEntry()`  
**Test:** `FINDING: validateEntry does NOT check path format — traversal strings pass entry validation`

`validateEntry` only validates field types. A manifest JSON with
`{ "path": "../../../etc/passwd", ... }` passes `validateEntry`.  
**Risk:** None in practice — the path would subsequently fail `isValidPathFormat()`
in `validatePath()` before any fetch. The safety relies on these two checks
being called together. The `validateEntry` function should arguably call
`isValidPathFormat(e.path)` itself for a self-contained guarantee.

---

### FINDING (Belt-and-suspenders gap): Vim `J` (join-lines) not nop'd

**File:** `src/editor/vim.ts` — `patchVimCommands()`  
**Test:** `FINDING: "J" (join lines) NOT mapped to <Nop> — belt-and-suspenders gap`

`J` in vim joins the current line with the next. It is not in the `Vim.map`
`<Nop>` list. `EditorState.readOnly.of(true)` is the real guard and will
reject the mutation at the CodeMirror level, so this is not exploitable.
However, the explicit nop list is incomplete for belt-and-suspenders coverage.

---

### FINDING (Belt-and-suspenders gap): Visual-mode `d` not nop'd

**File:** `src/editor/vim.ts` — `patchVimCommands()`  
**Test:** `FINDING: visual-mode "d" NOT nop-mapped (only normal mode)`

`Vim.map('d', '<Nop>', 'normal')` only covers normal mode. In visual mode,
`d` would attempt to delete the selection. Again, `EditorState.readOnly`
blocks this at the CM level — but the explicit nop list covers normal mode only.

---

### FINDING (Belt-and-suspenders gap): `:s` and `:put` ex commands not noop'd

**File:** `src/editor/vim.ts` — `patchVimCommands()`  
**Tests:** `FINDING: ":s" (substitute) ex command NOT overridden`, `FINDING: ":put" ex command NOT overridden`

The `patchVimCommands()` method noop's `:w`, `:wq`, `:x`, `:xit` but not
`:s/foo/bar/g` (substitute) or `:put`/`:r filename`. These are mutation
operations. `EditorState.readOnly` is the actual guard. If the vim layer were
ever bypassed (e.g., by a future `@replit/codemirror-vim` upgrade), these
commands could mutate state.

---

### FINDING (Low): `buildDOMList` root label inserts `node.name` via `innerHTML` without escaping

**File:** `src/explorer/tree.ts` — `buildDOMList()`  
**Test:** `tree.ts innerHTML injection guard > FINDING: buildDOMList root label inserts node.name via innerHTML without escaping`

```typescript
rootItem.innerHTML = `<span class="tree-icon icon-dir">${ICON_DIR_OPEN}</span>
  <span class="tree-label"><strong>${node.name}/</strong></span>`;
```

`node.name` is the first path segment from the manifest and is inserted
directly into `innerHTML` without `escapeHtml()`.  
**Risk:** Low-but-real. The regex `VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/` is the
only guard preventing a dir name like `<script>` from reaching this code path.
Should the manifest ever be loaded from an untrusted source, this would be XSS.
**Fix:** use `textContent` or `escapeHtml(node.name)` here.

---

## Coverage Assessment

| Area | Tested | Result |
|---|---|---|
| EventBus subscribe/unsubscribe/once | ✅ 10 tests | PASS — all correct |
| EventBus leak (1000 cycles) | ✅ | PASS |
| EventBus throw isolation | ✅ | PASS |
| Manifest path regex (15 attack paths) | ✅ | PASS — all rejected |
| Manifest path regex (6 valid paths) | ✅ | PASS |
| `loadFile` pre-fetch rejection (5 attack paths) | ✅ | PASS — none reach fetch |
| `validateManifest` shape | ✅ 6 tests | PASS |
| `validateEntry` shape | ✅ 4 tests | PASS |
| `VimEditor.isReadOnly()` always true | ✅ | PASS |
| `EditorState.readOnly.of(true)` present | ✅ | PASS |
| Vim nop mappings (d, p, x, c, r, s, i, a, o) | ✅ | PASS |
| Vim nop gaps (J, visual-d, :s, :put) | ✅ documented | FINDING |
| `VimEditor.destroy()` idempotent | ✅ | PASS |
| `VimEditor.destroy()` unsubscribes bus | ✅ | PASS |
| `FileExplorer` unknown-path highlight | ✅ | PASS |
| `FileExplorer` dir-click no FOCUS_FILE | ✅ | PASS |
| `FileExplorer` Enter on file | ✅ | PASS |
| `FileExplorer` Enter with no selection | ✅ | PASS |
| `FileExplorer` j/k single item | ✅ | PASS |
| `FileExplorer` j/k wraparound | ✅ | PASS |
| `FileExplorer` ? / Esc help overlay | ✅ | PASS |
| `FileExplorer` double-? no duplicate | ✅ | PASS |
| `FileExplorer` destroy() cleans bus subs | ✅ | PASS |
| `TreeNavigator` empty tree | ✅ | PASS |
| `TreeNavigator` cursor -1 / clamp top/bottom | ✅ | PASS |
| `TreeNavigator` detach idempotent | ✅ | PASS |
| `PowerlineBar` XSS in filePath | ✅ | PASS — escapeHtml |
| `PowerlineBar` XSS in mode / sepClass | ✅ | PASS — escapeHtml |
| `PowerlineBar` NaN clamp | ✅ | **VULNERABILITY** |
| `PowerlineBar` setLoading idempotent | ✅ | PASS |
| `getDefaultFile` no-parameter signature | ✅ | PASS |
| `getDefaultFile` fallback hardcoded | ✅ | PASS |
| tree.ts innerHTML without escaping | ✅ | FINDING |

---

## What Was NOT Testable (runtime-only paths)

- **Actual vim key handling in browser** — `Vim.map` and `EditorState.readOnly`
  require a real CM6 editor mounted in a real DOM. The jsdom environment does not
  support CodeMirror's canvas/DOM layout model. The static source-analysis tests
  confirm the correct APIs are called; end-to-end browser testing would be needed
  to verify the key handling at runtime.
- **`@replit/codemirror-vim` `Vim.map` correctness** — Tested at the "is the
  call present" level; actual key-blocking requires a running editor.
- **scrollIntoView visual behaviour** — jsdom stubs this; scrolling correctness
  is a browser-only concern.
- **CSS fade/transition cleanup** — opacity transitions require a browser layout
  engine.

---

## Verdict

The implementation is solid. The security model is correct: path injection is
blocked at the manifest-lookup level before any fetch; the event bus has no
leaks; the read-only enforcement uses CM6's `EditorState.readOnly.of(true)` as
the authoritative guard. The six findings are low-to-informational severity, with
the NaN clamping bug being the only issue that could surface as a visible UI
glitch (not a security issue).

**Recommended fixes (in priority order):**
1. **Fix NaN clamp in statusBar.ts** — `scrollPct = Math.max(0, Math.min(100, scrollPct)) || 0`
2. **Escape `node.name` in `buildDOMList` root label** — use `escapeHtml()` or `textContent`
3. **Tighten VALID_PATH_RE** — prevent `a/.md` / double-slash patterns
4. **Add J, visual-d, :s, :put to patchVimCommands nop list** — belt-and-suspenders

**Attacks repelled:** All path-traversal, XSS-via-filePath, event-leak, and
boundary-condition attacks were successfully repelled by the implementation.
