# Critic Report — m1-scaffold

**Date**: 2026-06-08  
**Branch**: `m1-scaffold`  
**Critic**: adversarial teammate  
**Test files**: `src/tests/test-path-validation.mjs`, `test-path-edge-cases.mjs`, `test-manifest-validation.mjs`, `test-theme-manager.mjs`

---

## Summary

**3 vulnerabilities found, 12 attacks repelled.**

The scaffold is broadly solid. Core security invariants (path traversal blocking, schema validation) hold. The failures are in build reproducibility and theme isolation — design-level issues rather than runtime exploits.

---

## Vulnerabilities Found

### VUL-1 — Build Non-Reproducibility (CONFIRMED BUG)
**Severity**: Medium  
**Location**: `vite.config.ts` line 74 — `buildDate: new Date().toISOString()`

**Reproduction**:
```
npm run build && cp dist/assets/manifest.json /tmp/m1.json
sleep 1
npm run build && diff /tmp/m1.json dist/assets/manifest.json
```
**Output**: `< "buildDate": "2026-06-08T20:07:58.327Z"` vs `> "buildDate": "2026-06-08T20:08:01.690Z"`

**Impact**: Every build produces a different `manifest.json`. CI diff checks fail. Content-hash-based CDN invalidation is over-triggered. Deterministic deploys impossible. Rollback comparison is unreliable.

**Fix**: Remove `buildDate` or set it from `SOURCE_DATE_EPOCH` / a git commit timestamp. A simpler fix is to derive `buildDate` from the latest file mtime rather than wall clock.

---

### VUL-2 — Theme Isolation Violated: CSS Variables Duplicated in HTML (CONFIRMED BUG)
**Severity**: Medium  
**Location**: `index.html` lines 173–195

**Reproduction**:
```bash
grep -n "\-\-tmux-green\|--bg-main\|--fg-main\|--ansi" index.html
```
**Output**: Full CSS variable table (`--tmux-green`, `--bg-main`, all 16 `--ansi-N`) defined as `:root` defaults **in the HTML**, separate from `theme.ts`.

Also: `#1d2021` and `#ebdbb2` are hardcoded directly (not through CSS vars) on lines 33, 34, 60, 85, 103, 130 — panel backgrounds bypass the theme system entirely.

**Impact**: `theme.ts` claims to be "single source of truth for all theme data." It isn't. If a future milestone changes a color in `theme.ts`, it must also change `index.html`. Theme switching (e.g., from gruvbox-dark to nord) won't update `html/body` background color or the panel backgrounds that use hardcoded `#1d2021`.

**Fix**: Remove the `:root {}` color table from `index.html`. The HTML should only contain structural CSS. Call `applyThemeCSSVars` before first render (already done in `index.ts`) to set all variables. For the flash-of-wrong-color problem, set a minimal `background: #1d2021` only on `body` (or use a `<meta name="theme-color">`).

---

### VUL-3 — `--tmux-green` Hardcoded in `applyThemeCSSVars` (DESIGN DEFECT)
**Severity**: Low  
**Location**: `src/theme.ts` line 125

```typescript
root.style.setProperty('--tmux-green', '#44ff88');  // same value regardless of theme
```

**Reproduction**: `setTheme('nord')` — dividers stay bright `#44ff88` even though Nord's accent is `#88c0d0`.

**Impact**: `--tmux-green` is semantically "the tmux divider accent color" but its value is baked as a constant `#44ff88` regardless of active theme. If nord or tokyo-night is selected, the divider color clashes with the palette. The variable name `--tmux-green` implies it should be a theme-derived color.

**Fix**: Add a `tmuxAccent` field to `ThemeColors` (or derive it from an ANSI green), and use `c.tmuxAccent` in `applyThemeCSSVars`. Alternatively, rename to `--tmux-divider-color` and document it as a constant if the design intent is always green.

---

## Attacks Repelled

| # | Attack | Result |
|---|--------|--------|
| 1 | Non-.md file (`www/image.png`) in www/ | **Repelled** — ignored, not in manifest, no crash |
| 2 | Deeply nested file (`www/a/b/c/deep.md`) | **Repelled** — correct path and sections in manifest |
| 3 | Special chars in filename (`my-project-2024.md`) | **Repelled** — handled correctly |
| 4 | Empty `.md` file | **Repelled** — empty excerpt, fallback title from filename, no crash |
| 5 | Missing `www/` directory entirely | **Repelled** — empty manifest, no crash |
| 6 | Path traversal (`../../../etc/passwd`) | **Repelled** — regex blocks `.` character |
| 7 | Absolute path (`/etc/passwd`) | **Repelled** — regex requires `^[a-z0-9/_-]+\.md$` |
| 8 | Empty string, null, undefined, Number, Object inputs | **Repelled** — type guard + regex reject all |
| 9 | Front-matter-only `.md` (no body) | **Repelled** — empty excerpt produced correctly |
| 10 | Content with `<script>` XSS / SQL injection in title | **Repelled** at build level (stored raw — consumers must sanitize on render) |
| 11 | ThemeManager with unknown theme name | **Repelled** — throws descriptive error |
| 12 | ThemeManager listener leak (1000 subscribe+unsubscribe cycles) | **Repelled** — Set-based listeners, no leak |

---

## Coverage Gaps (Not Bugs, But Worth Noting)

- **`getManifestEntry(path)`** has no format validation — it's a raw `Map.get`. Callers must use `validatePath` first; nothing enforces this at call sites.
- **`validateManifest` is not strict** — extra properties on entries are silently accepted (not a security bug since data is build-time, but fragile).
- **Hash field not validated for hex format** — any string passes as `hash`. A tampered manifest could have `hash: "../etc/passwd"`.
- **Sections array has no length limit** — maliciously crafted manifest could have huge sections arrays.
- **Path regex accepts `a/.md`**, `//foo.md`, `a//b.md` (double-slash, trailing slash before `.md`) — these pass `isValidPathFormat` but would never be in `entryIndex` (safe in practice, weak in isolation).
- **Manifest entry sort order** depends on filesystem `readdirSync` ordering — stable on Linux ext4, not portable (e.g., macOS HFS returns different order).

---

## Test Files Added

All tests in `src/tests/` (committed to `m1-scaffold` branch):

- `test-path-validation.mjs` — 21 cases covering traversal, null, undefined, type errors
- `test-path-edge-cases.mjs` — regex boundary cases (double-slash, dotfiles, `a/.md`)
- `test-manifest-validation.mjs` — 21 cases covering schema validation edge cases and prototype pollution
- `test-theme-manager.mjs` — 9 cases covering unknown themes, listener lifecycle, null inputs

Run with: `node src/tests/<filename>.mjs`

---

## Re-verification (post-fix)

**Date**: 2026-06-08  
**Verifier**: Critic re-run (adversarial)  
**Branch**: `m1-scaffold` (post m1-fix merge)  
**Overall verdict**: **PASS — all 3 vulnerabilities correctly fixed**

---

### VUL-1 — Build Reproducibility — FIXED ✓

**Test performed**: Built twice, diffed `dist/assets/manifest.json`.

```
npm run build   # build 1 → /tmp/manifest-build1.json
npm run build   # build 2 → /tmp/manifest-build2.json
diff /tmp/manifest-build1.json /tmp/manifest-build2.json
→ IDENTICAL (no output)
```

**Code check**: `vite.config.ts` — searched for `buildDate` and `toISOString` in the manifest plugin.
Neither appears in the `generateBundle()` function. `ManifestEntry` interface has only
`{ path, title, sections, excerpt, hash }` and `Manifest` has `{ entries, version }`.

**Built artifact check**: `dist/assets/manifest.json` top-level keys: `['entries', 'version']`.
No `buildDate` field present.

**Note**: The built JS (`dist/assets/main-*.js`) does contain `toISOString()` — this is the
logging utility's timestamp helper (`function f(){return new Date().toISOString()}`), NOT manifest
generation. This is correct; log timestamps are ephemeral and do not affect build reproducibility.

**Verdict**: FIXED ✓

---

### VUL-2 — Theme Source-of-Truth — FIXED ✓

**Test performed**:

1. `grep -n ":root" index.html` — **no output**. The `:root {}` CSS variable table has been
   completely removed.

2. `grep -n "\-\-tmux-green:\|--bg-.*:\|--fg-.*:\|--ansi-" index.html` — **no output**.
   No CSS variable *definitions* remain in index.html.

3. Panel background declarations — all panels now use `var(--bg-main)`:
   - `#agent-shell`: `background: var(--bg-main)` ✓
   - `#file-explorer`: `background: var(--bg-main)` ✓
   - `#vim-editor-container`: `background: var(--bg-main)` ✓
   - `#cli-drawer`: `background: var(--bg-main)` ✓

4. Remaining hex colors in index.html are **only** CSS `var()` fallback values or the single
   FOUC-prevention line (documented with a comment):
   - `body { background: #1d2021; }` — explicit FOUC guard with comment: "overridden immediately
     by applyThemeCSSVars() in index.ts"
   - `background: var(--bg-main, #1d2021)` — fallback inside var() on html/body
   - `color: var(--fg-main, #ebdbb2)` — fallback inside var() on html/body
   - `border: 1px solid var(--fg-main, #ebdbb2)` — hamburger button fallback
   - Dividers: `var(--tmux-green, #44ff88)` — fallback inside var()

   None of these constitute a duplicate source-of-truth; they are defensive fallbacks.

5. `src/theme.ts` still exports `applyThemeCSSVars()` and `index.ts` calls it at startup:
   `import { ThemeManager, applyThemeCSSVars } from './theme.js'` and
   `applyThemeCSSVars(themeManager.getTheme())` on line 27.

**Verdict**: FIXED ✓

---

### VUL-3 — `--tmux-green` Hardcoded — FIXED ✓

**Test performed**:

1. **ThemeColors interface** (`src/types.ts`) — `accentColor: string` field confirmed present with
   docstring: "Accent color used for tmux-style dividers and UI highlights. Varies per theme."

2. **Each theme has a distinct accentColor**:
   - `gruvbox-dark`: `accentColor: '#44ff88'` (bright green)
   - `nord`: `accentColor: '#88c0d0'` (Nord cyan/ice-blue) — **different from gruvbox**
   - `tokyo-night`: `accentColor: '#7aa2f7'` (Tokyo Night blue) — **different from both**
   All three are distinct values.

3. **`applyThemeCSSVars` uses `c.accentColor`** (not a hardcoded string):
   ```typescript
   root.style.setProperty('--tmux-green', c.accentColor);  // line 128
   ```
   Confirmed: no hardcoded `'#44ff88'` string in `applyThemeCSSVars`.

4. **Built JS confirmation**: The minified output shows three distinct theme objects with their
   respective `accentColor` fields, and the `applyThemeCSSVars` equivalent uses `n.accentColor`
   (not a literal string).

**Verdict**: FIXED ✓

---

### Test Suite Results (post-fix)

```
test-theme-manager.mjs:       9 passed, 0 failed  ✓
test-manifest-validation.mjs: 21 passed, 0 failed  ✓
test-path-validation.mjs:     21 passed, 0 failed  ✓
test-path-edge-cases.mjs:      4 passed, 3 failed  (pre-existing, not VUL-related)
```

The 3 failures in `test-path-edge-cases.mjs` are pre-existing regex boundary cases (`a/.md`,
`//foo.md`, `a//b.md`) that were already flagged as "Coverage Gaps" in the original report — they
are not regressions and not related to the three fixed VULs.

`npm run build` completes cleanly (TypeScript + Vite, 0 errors).

---

### Final Verdict: PASS

| VUL | Description | Status |
|-----|-------------|--------|
| VUL-1 | Build reproducibility (buildDate in manifest) | **FIXED** ✓ |
| VUL-2 | Theme source-of-truth (CSS vars duplicated in HTML) | **FIXED** ✓ |
| VUL-3 | --tmux-green hardcoded in applyThemeCSSVars | **FIXED** ✓ |
