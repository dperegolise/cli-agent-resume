# Worker Report — m1-fix (Critic Vulnerability Fixes)

**Branch**: `m1-scaffold`  
**Date**: 2026-06-08  
**Commit**: `9c40200`  
**Task**: #13 — m1-fix: critic-m1 vulnerabilities

---

## Summary

Fixed all 3 vulnerabilities identified in `critic-m1.md`. All changes are additive/correctional — no behaviour removed, no stub code, no hardcoded test values.

---

## Changes Made

### VUL-1 — Build Reproducibility (`vite.config.ts`, `src/manifest.ts`, `src/types.ts`)

**Root cause**: `buildDate: new Date().toISOString()` in the Vite manifest plugin used wall-clock time, making every build produce a unique `manifest.json`.

**Fix**:
- Removed `buildDate` field entirely from:
  - `vite.config.ts` — manifest plugin no longer emits `buildDate`
  - `src/types.ts` — `Manifest` interface no longer has `buildDate`
  - `src/manifest.ts` — `validateManifest()` no longer checks for `buildDate`
- The `hash` field (SHA-256 first 12 chars of file content) is sufficient for cache-busting — it changes when content changes, not when builds happen.

**Verification**: Two consecutive `npm run build` calls with a 1-second sleep between them produce byte-for-byte identical `dist/assets/manifest.json`.

---

### VUL-2 — Theme Source-of-Truth (`index.html`)

**Root cause**: `index.html` contained a full `:root {}` CSS variable table (20 properties) duplicating `theme.ts`, plus 5 hardcoded `#1d2021` panel background values that bypassed the theme system.

**Fix**:
1. Removed the entire `:root { --tmux-green: ...; --bg-main: ...; ... }` block from `index.html`.
2. Replaced all 5 hardcoded `#1d2021` panel background occurrences with `var(--bg-main)`:
   - `#agent-shell`
   - `#file-explorer`
   - `#vim-editor-container`
   - `#cli-drawer`
3. Kept a single `body { background: #1d2021; }` line as a paint fallback for flash-of-wrong-color prevention (acceptable per task spec).
4. Added `var(--X, fallback)` graceful-degradation fallbacks to the html/body rule and other structural CSS (these are CSS-spec CSS variable fallbacks, not duplicated theme data).
5. `applyThemeCSSVars()` was already called before panel mounts in `src/index.ts` — no change needed there.

**Verification**: `grep -n '#[0-9a-fA-F]' index.html` shows only `body { background: #1d2021; }` and CSS `var(--X, fallback)` patterns — no standalone hardcoded panel backgrounds.

---

### VUL-3 — `--tmux-green` Theme-Adaptive (`src/theme.ts`, `src/types.ts`)

**Root cause**: `applyThemeCSSVars()` hardcoded `'#44ff88'` for `--tmux-green` regardless of which theme was active, causing Nord and Tokyo Night themes to show Gruvbox's accent color on dividers.

**Fix**:
1. Added `accentColor: string` field to `ThemeColors` interface in `src/types.ts`.
2. Set `accentColor` per theme in `src/theme.ts`:
   - `gruvbox-dark`: `#44ff88` (unchanged — the original bright green)
   - `nord`: `#88c0d0` (Nord cyan/ice-blue — the signature Nord accent)
   - `tokyo-night`: `#7aa2f7` (Tokyo Night blue — the primary UI accent)
3. Updated `applyThemeCSSVars()` to use `c.accentColor` instead of the hardcoded constant.

**Note**: The field name `accentColor` was chosen (not `tmuxAccent`) to keep it broadly applicable for future UI use beyond dividers. This is additive — nothing from `m4-vim-panel`'s `theme.ts` changes is removed.

---

### Test Updates (`src/tests/test-manifest-validation.mjs`)

The critic's `test-manifest-validation.mjs` reproduced the old `validateManifest` logic including `buildDate`. Updated to match the new schema:
- Removed `buildDate` from `validateManifest` reproduction
- Removed `buildDate` from `validManifest` fixture
- Replaced `'Missing buildDate rejected'` test with `'buildDate field ignored (removed from schema)'`
- Replaced `'buildDate=42 rejected'` with `'version=42 rejected'` (equivalent coverage for type checking)
- All 21 manifest tests still pass.

---

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| `test-path-validation.mjs` | 21 | ✅ All pass |
| `test-path-edge-cases.mjs` | (run separately, no changes) | ✅ Unaffected |
| `test-manifest-validation.mjs` | 21 | ✅ All pass |
| `test-theme-manager.mjs` | 9 | ✅ All pass |
| `npm run build` (reproducibility) | 2 builds diffed | ✅ Identical output |

---

## Interface/Contract Changes (downstream impact)

| Contract | Change | Impact |
|----------|--------|--------|
| `Manifest.buildDate` | **Removed** from `src/types.ts` | Any code reading `manifest.buildDate` at runtime will get `undefined`. No current milestone reads this field at runtime (it was build-time metadata only). |
| `ThemeColors.accentColor` | **Added** to `src/types.ts` | Other Workers adding new themes (e.g., `m4-vim-panel`) must add `accentColor` to any new `ThemeColors` objects. TypeScript will enforce this at compile time. |
| `validateManifest` | `buildDate` check removed | Manifests without `buildDate` now pass validation (correct, since we no longer emit it). |

---

## Files Changed

- `vite.config.ts` — removed `buildDate` from manifest plugin and interface
- `src/types.ts` — removed `buildDate` from `Manifest`; added `accentColor` to `ThemeColors`
- `src/manifest.ts` — removed `buildDate` check from `validateManifest`
- `src/theme.ts` — added `accentColor` to all three theme color objects; `applyThemeCSSVars` uses `c.accentColor`
- `index.html` — removed `:root {}` color table; replaced hardcoded panel backgrounds with `var(--bg-main)`
- `src/tests/test-manifest-validation.mjs` — updated to match new schema
