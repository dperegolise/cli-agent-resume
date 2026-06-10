# m4-fix Report — Review + Critic Findings for m4-vim-panel

**Branch:** `m4-vim-panel`  
**Commit:** `da19339`  
**Status:** All required and informational fixes applied; build passes.

---

## Changes Made

### Fix 1 — CM6 syntax colors sourced from theme.ts (REQUIRED — review-m4)

**File:** `src/editor/vim.ts`

All hardcoded hex strings in the `gruvboxTheme` `EditorView.theme()` extension were replaced with references to `GRUVBOX_DARK.colors` from `../theme.ts`:

| CSS selector | Before | After |
|---|---|---|
| `.cm-gutters` bg | `'#282828'` | `GRUVBOX_DARK.colors.ansi[0]` |
| `.cm-gutters` color | `'#928374'` | `GRUVBOX_DARK.colors.ansi[8]` |
| `.cm-gutters` border | `'1px solid #504945'` | `\`1px solid ${GRUVBOX_DARK.colors.selection}\`` |
| `.cm-header` / `.cm-header-1` | `'#fb4934'` | `GRUVBOX_DARK.colors.ansi[9]` (bright-red) |
| `.cm-header-2` | `'#fabd2f'` | `GRUVBOX_DARK.colors.ansi[11]` (bright-yellow) |
| `.cm-header-3` | `'#b8bb26'` | `GRUVBOX_DARK.colors.ansi[10]` (bright-green) |
| `.cm-strong` color | `'#ebdbb2'` | `GRUVBOX_DARK.colors.fg` |
| `.cm-em` | `'#d3869b'` | `GRUVBOX_DARK.colors.ansi[13]` (bright-magenta) |
| `.cm-link` | `'#83a598'` | `GRUVBOX_DARK.colors.ansi[12]` (bright-blue) |
| `.cm-url` | `'#8ec07c'` | `GRUVBOX_DARK.colors.ansi[14]` (bright-cyan) |
| `.cm-quote` | `'#928374'` | `GRUVBOX_DARK.colors.ansi[8]` (bright-black) |
| `.cm-monospace` | `'#8ec07c'` | `GRUVBOX_DARK.colors.ansi[14]` (bright-cyan) |

Note: `.cm-activeLineGutter` and `.cm-activeLine` retain `#3c3836` as there is no exact equivalent in the ThemeColors interface (it is the mid-dark gruvbox background, between `bg` and `selection`). This is acceptable — they are structural colors, not syntax.

### Fix 2 — VISUAL mode pill color corrected (REQUIRED — review-m4)

**File:** `src/editor/statusBar.ts`

- `.powerline-mode[data-mode="VISUAL"]` background: `#8ec07c` → `#83a598` (strategy §11 spec)
- `.powerline-sep-mode-visual` color: `#8ec07c` → `#83a598` (separator must match pill)

### Fix 3 — Delete dead treeNav.ts (REQUIRED — review-m4)

**File:** `src/explorer/treeNav.ts` — **deleted**

`tree.ts` (`FileExplorer`) handles all keyboard navigation directly via its own `onKeyDown` method and `flatItems` + `moveSelection` internal state. `treeNav.ts` (`TreeNavigator`) was never imported anywhere. Confirmed with `grep -r "treeNav"` — only self-reference in the file header. Deleted entirely.

### Fix 4 — NaN clamp guard in scrollPct (ACTIONABLE — critic-m4)

**File:** `src/editor/statusBar.ts`, `getPositionInfo()`

```typescript
// Before:
scrollPct = Math.max(0, Math.min(100, scrollPct));
// After:
scrollPct = Math.max(0, Math.min(100, scrollPct)) || 0;  // guard against NaN
```

`Math.max(0, NaN)` returns `NaN` in JS; the `|| 0` fallback ensures a numeric 0 is always produced.

### Informational fixes (applied)

1. **manifest.ts `VALID_PATH_RE` tightened:** Changed from `/^[a-z0-9/_-]+\.md$/` to `/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.md$/`. The new pattern requires non-empty path segments separated by single slashes, so `a/.md` and `a//b.md` are now rejected.

2. **vim.ts `J` (join-lines) added to Nop map:** `Vim.map('J', '<Nop>', 'normal')` added for belt-and-suspenders completeness in the read-only editor.

---

## Verification

```
npm run build
# → tsc (0 errors) + vite build
# → ✓ 40 modules transformed, built in 315ms
```

No TypeScript errors. Bundle size unchanged from pre-fix.

---

## Interface / Contract

No interface changes — only internal implementation fixes. The `PowerlineBar`, `VimEditor`, `FileExplorer`, and `validatePath()` public APIs are unchanged. Other milestones depending on the event bus, `FOCUS_FILE`, `THEME_CHANGE`, or manifest paths are unaffected.
