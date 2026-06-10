# Worker Report — m2-fix (critic findings for m2-layout)

**Branch**: `m2-layout`  
**Commit**: `cef1457`  
**Files changed**: `src/layout/responsive.ts`, `src/layout/style.css`  
**Date**: 2026-06-08

---

## Summary

Fixed all three issues identified in `critic-m2.md`: one confirmed bug (breakpoint mismatch)
and two architectural risks (HMR listener accumulation, Ctrl+` firing in editable fields).

---

## Fix 1 — Breakpoint mismatch (V1, Medium severity)

**Problem**: `responsive.ts` used `max-width: 767px` (via `MOBILE_BREAKPOINT - 1`) while
`style.css` used `@media (max-width: 768px)`. At exactly 768px, CSS applied mobile styles
but `isMobile()` returned `false` — a ghost zone where the JS and CSS disagreed.

**Change**:
- Replaced `const MOBILE_BREAKPOINT = 768` with `const MOBILE_BREAKPOINT_PX = '767.98px'`
- Updated `window.matchMedia` call to use `(max-width: 767.98px)`
- Updated CSS `@media` query from `(max-width: 768px)` to `(max-width: 767.98px)`

The fractional value (`767.98px`) avoids integer-rounding ambiguity on high-DPI screens.
Both JS and CSS now use the same single canonical value.

**Verified**: `grep` confirms no stray `768px` or `767px` values remain in either file.

---

## Fix 2 — HMR listener accumulation (R1, Medium/dev severity)

**Problem**: `DrawerToggle.init()` called `document.addEventListener('keydown', ...)` every
time. On Vite HMR re-calls, listeners would accumulate — N calls → N toggles per Ctrl+` press.

**Change**: Added a module-level `let _keydownHandler: ((e: KeyboardEvent) => void) | null = null`.
At the start of `init()`, if `_keydownHandler` is non-null, the previous listener is removed
via `document.removeEventListener('keydown', _keydownHandler)` before registering the new one.
This makes `init()` idempotent with respect to keydown listeners.

---

## Fix 3 — Ctrl+` fires in editable fields (R2)

**Problem**: The `document.keydown` handler for Ctrl+` had no focus check. Any `<input>` or
`<textarea>` on the page receiving Ctrl+` would collapse/expand the drawer unexpectedly (and
`e.preventDefault()` would also swallow the character).

**Change**: Added a guard at the top of the handler:
```typescript
const tag = (e.target as HTMLElement).tagName;
const isEditable =
  tag === 'INPUT' ||
  tag === 'TEXTAREA' ||
  (e.target as HTMLElement).isContentEditable;
if (isEditable) return;
```
The `e.preventDefault()` and `this.toggle()` calls are only reached when the event target is
not an editable element.

---

## Build result

```
npm run build → tsc && vite build
✓ 14 modules transformed
✓ built in 91ms
0 TypeScript errors
```

Build passes cleanly with no warnings related to the changed files.

---

## Interfaces / contracts touched

- `src/layout/responsive.ts` — `MOBILE_BREAKPOINT_PX` constant (renamed from `MOBILE_BREAKPOINT`,
  internal only — no external callers reference the constant directly).
- `src/layout/style.css` — mobile `@media` query breakpoint changed from `768px` to `767.98px`.
- Public API of `MobileLayout`, `DrawerToggle`, and `initLayout()` is **unchanged**.

---

## What was NOT fixed (code quality issues from critic, intentionally deferred)

- Q1 (`.sidebar-open` dead CSS on `#mobile-explorer-sidebar`) — harmless, deferred
- Q2 (`rgba()` literal colors not in CSS vars) — non-conforming in spirit only, deferred
- Q3 (backdrop desync via external class manipulation) — mild encapsulation note, not a bug
- Q4 (legacy `#hamburger-menu` dead HTML) — harmless, deferred
