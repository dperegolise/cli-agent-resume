# m5-fix Report

**Branch**: `m5-cli-drawer`
**Commit**: `00ea40c`

## Summary

Fixed all required findings from review-m5 and critic-m5 in a single commit.

## Changes Made

### F1 (REQUIRED — review-m5): Double setTheme in THEME_CHANGE subscriber

**File**: `src/drawer/terminal.ts`

The `subscribeTheme()` method had a bug where the THEME_CHANGE event handler first called `themeManager.getTheme()` to update `term.options.theme`, then — if `evt.themeName` was truthy — called `themeManager.setTheme(evt.themeName)` again, which would fire `applyThemeCSSVars()` and all `onThemeChange` listeners a second time.

**Fix**: Removed the `if (evt.themeName)` block entirely. The subscriber now only reads the already-updated manager state via `themeManager.getTheme()` and applies it to the terminal. The event parameter is renamed to `_evt` since it's now unused.

```typescript
// Before: ~20 lines with redundant setTheme re-call
// After:
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

### F3 (ADVISORY — review-m5): Hardcoded theme name lists

**Files**: `src/drawer/commands.ts`, `src/drawer/completion.ts`

Both files previously hardcoded `['gruvbox-dark', 'nord', 'tokyo-night']` (and the corresponding joined strings).

**Fix**:
- Added `import { THEME_NAMES } from '../theme.js';` to both files
- `commands.ts`: replaced `validThemes` local array with `THEME_NAMES` in the validation check, and replaced hardcoded strings in both error messages and the help table entry with `THEME_NAMES.join(', ')` / `THEME_NAMES.join(' | ')`
- `completion.ts`: replaced the inline literal array in `getCandidates()` with `THEME_NAMES`

### VUL-1 + VUL-2 (MEDIUM/LOW — critic-m5): VALID_PATH_RE accepts absolute paths and empty segments

**File**: `src/manifest.ts`

The old regex `/^[a-z0-9/_-]+\.md$/` included `/` in its character class without any anchor on the first character, so `/a.md` (absolute path) and `a//b.md` (empty segment) both passed format validation.

**Fix**: Replaced with the stricter regex that requires each path segment to start with an alphanumeric character:

```typescript
// Before:
const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

// After:
const VALID_PATH_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/;
```

This regex:
- Requires the first character to be `[a-z0-9]` (no leading `/`)
- Allows subsequent characters in a segment to be `[a-z0-9_-]`
- Requires any additional segments to start with `[a-z0-9]` (no empty segments, no `//`)
- Subsumes both VUL-1 and VUL-2

## Build Results

```
tsc && vite build
✓ 18 modules transformed
✓ built in 165ms
0 errors
```

## Tests

`npm run build` (tsc + vite) passes with 0 errors. No unit-test suite exists for these modules.

## Interface / Contract Notes

- `VALID_PATH_RE` change is purely internal to `manifest.ts`; `validatePath()` public API is unchanged
- `THEME_NAMES` is now imported rather than redefined in `commands.ts` and `completion.ts` — single source of truth remains `src/theme.ts`
- The subscriber simplification in `terminal.ts` is backward-compatible: the theme is already set on the manager before the event fires, so `getTheme()` returns the correct new theme
