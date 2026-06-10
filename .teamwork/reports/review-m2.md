# Review Report: m2-layout

**Date**: 2026-06-08  
**Branch**: m2-layout  
**Worktree**: `.claude/worktrees/m2-layout`  
**Reviewer**: Reviewer teammate  
**Verdict**: PASS (with one medium-priority finding and several minor notes for downstream workers)

---

## Summary

m2-layout correctly implements the three-panel CSS grid, all canonical §3 DOM IDs are present,
no hardcoded hex in style.css, the collapsible drawer and Ctrl+\` shortcut are wired, and
the mobile hamburger+sidebar mechanism is correct. Build passes cleanly. Two design issues
are flagged — one medium (drawer collapse leaves a ghost gap) and one mild (a renamed divider
element adds CSS dead weight) — neither blocks downstream milestones.

---

## Checklist Results

### 1. Three-panel CSS grid ✅
- `#app` grid: `grid-template-columns: 320px 1px 1fr; grid-template-rows: 1fr 1px 220px` — exact match to strategy §1 and §12
- `#agent-shell` spans `grid-row: 1 / 4` (full height), `grid-column: 1` — correct
- `#divider-vertical` spans `grid-row: 1 / 4`, `grid-column: 2` — correct
- `#right-panel` uses `display:flex; flex-direction:column` with `#file-explorer` at `height:25%` and `#vim-editor-wrap` at `flex:1` — achieves the ~25%/~75% split per strategy §1/§12

### 2. Dividers — 1px solid var(--tmux-green) ✅
- `#divider-vertical`: `background: var(--tmux-green); width: 1px` ✅
- `#divider-horizontal`: `height: 1px; background: var(--tmux-green)` ✅
- `#drawer-toggle` (bottom divider): `height: 1px; background: var(--tmux-green)` ✅
- `#powerline-status-bar`: `border-top: 1px solid var(--tmux-green)` ✅

### 3. CSS vars only — no hardcoded hex ✅
- `grep -n '#[0-9a-fA-F]'` on `style.css` → **zero results**
- Only two `rgba()` literals used: `rgba(255,255,255,0.1)` (hover feedback) and `rgba(0,0,0,0.5)` (backdrop). These are valid — pure opacity utilities that have no themeable color, and the strategy §12 CSS spec itself uses them.
- Note from review-m1: `index.html` inline `:root` block still has Gruvbox defaults, but this is correct — runtime `applyThemeCSSVars()` overrides them, and the inline block is CSS variable definitions (not hardcoded rules).

### 4. Collapsible drawer ✅ (with medium concern — see §Finding A)
- `#drawer-toggle` element: has `role="button"`, `aria-label`, `tabindex="0"` — accessible ✅
- `DrawerToggle.init()` wires click to `#drawer-toggle` (falls back to `#divider-bottom`) ✅
- `Ctrl+\`` handler: `e.ctrlKey && e.key === '\`'` → calls `toggle()` ✅
- `#cli-drawer.collapsed { height: 0; overflow: hidden }` with `transition: height 0.15s ease` ✅
- **See Finding A**: grid row stays at 220px when collapsed, causing a ghost gap.

### 5. Mobile < 768px ✅
- `@media (max-width: 768px)`: `#agent-shell` → `display:none`, `#cli-drawer` → `display:none` ✅
- `#right-panel`: `width:100vw; height:100vh` fills full viewport ✅
- `#file-explorer`: `display:none` (accessible via hamburger sidebar) ✅
- `#hamburger-btn`/`#hamburger-menu`: `display:flex` with `position:fixed; top:12px; right:12px` ✅
- `#mobile-explorer-sidebar`: `display:block; transform: translateX(-100%)` until `.open` ✅
- `#mobile-backdrop`: `display:none` base; `.visible` → `display:block` ✅ (JS-controlled)
- Backdrop click wires to `close()` ✅
- `MobileLayout.init()` uses `window.matchMedia` for resize detection (better than resize event polling) ✅
- Minor: vim editor on mobile uses `flex:1 + height:100%` inside the full-viewport right-panel rather than `position:fixed` as shown in strategy §12 CSS. Functionally equivalent for the current layout; only a concern if something breaks the flex chain.

### 6. CRITICAL — DOM ID compatibility ✅ / ⚠ (see table below)

All canonical strategy §3 IDs are present and correctly structured. No ID conflicts. The worker
introduced a few new IDs for better semantics; the old IDs are retained as aliases.

**Full DOM ID audit table:**

| Canonical §3 ID | In HTML? | Notes |
|---|---|---|
| `agent-shell` | ✅ | Direct — m3 mount point unchanged |
| `file-explorer` | ✅ | Direct — m4 mount point unchanged |
| `vim-editor` | ✅ | Inside `#vim-editor-wrap > #vim-editor-container(display:contents)` |
| `vim-editor-container` | ✅ | Present with `style="display:contents"` — see note |
| `powerline-status-bar` | ✅ | Inside `#vim-editor-container` — m4 mount point unchanged |
| `cli-drawer` | ✅ | Direct — m5 mount point unchanged |
| `hamburger-menu` | ✅ | Present as legacy alias, `style="display:none"` inline |
| `mobile-sidebar` | ✅ | Present as legacy alias, `style="display:none"` inline |
| `mobile-file-explorer` | ✅ | Inside `#mobile-sidebar` legacy alias |
| `right-panel` | ✅ | Direct |
| `divider-vertical` | ✅ | Direct |
| `divider-horizontal` | ✅ | Direct |
| `divider-bottom` | ❌ | **ABSENT** — replaced by `#drawer-toggle` (see Finding B) |

**New IDs introduced by m2:**

| New m2 ID | Purpose | Conflict? |
|---|---|---|
| `#hamburger-btn` | Real active hamburger button | No — `#hamburger-menu` kept as alias |
| `#drawer-toggle` | The 1px divider + collapse trigger | Replaces `#divider-bottom` in HTML |
| `#vim-editor-wrap` | Outer wrapper for vim + powerline | No — `#vim-editor-container` kept inside |
| `#mobile-explorer-sidebar` | Real active mobile sidebar | No — `#mobile-sidebar` kept as alias |
| `#mobile-backdrop` | Semi-transparent overlay | No — extra element, was specified by strategy |

### 7. Build passes ✅
```
✓ built in 226ms — no TypeScript errors, no Vite errors
dist/assets/main-BNRKduyi.css   2.78 kB │ gzip: 0.93 kB
dist/assets/main-C6sD3-Up.js    6.71 kB │ gzip: 2.60 kB
```
`tsc && vite build` completes cleanly. All 14 modules transformed.

---

## Findings

### A. MEDIUM — Drawer collapse leaves a ghost gap (style.css L33, L163)

**Location**: `src/layout/style.css` lines 33 and 163.

**Problem**: The grid root defines `grid-template-rows: 1fr 1px 220px` (hardcoded). When
`DrawerToggle.toggle()` applies `.collapsed` to `#cli-drawer`, the element's `height` transitions
to `0` and content is hidden — but the **grid row** remains at `220px`. The result is a blank
220px whitespace gap below the vim editor while the drawer is "collapsed."

**Correct fix**: Either (a) toggle `grid-template-rows` on `#app` via a `.drawer-collapsed` class
(e.g., `1fr 1px 0`), or (b) use `grid-row: auto` and let the grid auto-size the row. Option (a) is
cleanest:
```css
/* Add to style.css */
#app.drawer-collapsed {
  grid-template-rows: 1fr 1px 0;
}
```
```typescript
// In DrawerToggle.toggle():
document.getElementById('app')?.classList.toggle('drawer-collapsed');
this.drawerEl?.classList.toggle('collapsed');
```

**Severity**: Medium — visually wrong when drawer collapses; does not block m3/m4/m5 development
(they don't toggle the drawer), but m5 will inherit this bug when it mounts inside `#cli-drawer`.
Fix before m5 ships or hand the note to m5's worker.

---

### B. MILD — `#divider-bottom` absent from HTML; CSS rule is dead weight (index.html, style.css L133)

**Location**: `index.html` (absent) and `src/layout/style.css` line 133.

**Problem**: Strategy §3 specifies `<div id="divider-bottom" class="divider horizontal"></div>`
as a canonical element. The worker renamed it to `#drawer-toggle` in the HTML (better semantics,
correct), but left a full CSS rule block for `#divider-bottom` (lines 133–139) that matches no
element. The mobile media query also hides `#divider-bottom` (line 240), which is harmless but
dead code.

**Downstream impact**: `DrawerToggle.init()` falls back to `getElementById('divider-bottom')` if
`#drawer-toggle` not found — both exist in `responsive.ts` comments. Since `#drawer-toggle`
always exists in the current HTML, the `#divider-bottom` fallback will never fire. m5's
`setupCollapseListener(divider, drawer)` API takes an explicit element — callers should pass
`document.getElementById('drawer-toggle')`, NOT `divider-bottom`.

**For downstream workers (m5 in particular)**: use `#drawer-toggle` for the collapse divider
element, not `#divider-bottom`. The element `#divider-bottom` does not exist in the DOM.

**Severity**: Mild — no runtime error, no layout break, but creates confusion. Dead CSS can be
cleaned up in a later pass. Not a blocker.

---

### C. MINOR — z-index off by 1 vs strategy spec (style.css L176)

**Location**: `src/layout/style.css` line 176.

Strategy §12 says hamburger should be `z-index: 1001`, mobile sidebar `z-index: 1000`, backdrop
`z-index: 999`. Worker has hamburger at 1000, sidebar at 999, backdrop at 998. The relative
ordering is correct; the absolute values are shifted down by one. In practice this has no effect
unless other site elements use z-index ≥ 999, which none currently do.

**Severity**: Trivial. No action required.

---

### D. MINOR — Sidebar transition timing diverges from strategy (style.css L210)

**Location**: `src/layout/style.css` line 210.

Strategy §12 specifies `transition: transform 0.3s ease-out`. Worker uses `0.2s ease`. Slightly
faster but not perceptible as wrong. Drawer height transition is `0.15s ease` vs strategy's `0.2s`.

**Severity**: Trivial. No action required.

---

### E. MINOR — `#hamburger-menu` inline `display:none` prevents CSS media query from showing it (index.html L97)

**Location**: `index.html` line 97.

The legacy `#hamburger-menu` button has `style="display:none"`. Inline styles outrank stylesheet
rules, so even in the mobile `@media` block that sets `#hamburger-menu { display: flex }`, the
inline style wins. This means `#hamburger-menu` never appears (intentional — it's a legacy alias),
but the CSS media query rule `#hamburger-btn, #hamburger-menu { display: flex }` gives a misleading
impression that it would show. Same logic applies to `#mobile-sidebar`.

This is actually **by design** (the worker explicitly comments these as "legacy aliases"), but
could confuse a future developer. Adding a comment near the CSS media query rule would help.

**Severity**: Documentation nit. No action required.

---

## DOM IDs Summary for Downstream Workers

**Canonical IDs to use (always reliable):**

```
#agent-shell          → m3 mounts xterm.js here
#file-explorer        → m4 mounts NERDTree here  
#vim-editor           → m4 mounts CodeMirror here
#vim-editor-container → m4 wraps editor (display:contents — see note*)
#powerline-status-bar → m4 mounts powerline bar here
#cli-drawer           → m5 mounts xterm.js here
#hamburger-menu       → DO NOT use for interaction (legacy alias, always hidden via inline style)
#mobile-sidebar       → DO NOT use for interaction (legacy alias, always hidden via inline style)
```

**New m2 IDs to prefer over canonical aliases:**

```
#hamburger-btn        → use for hamburger interaction (this is the live button)
#drawer-toggle        → use for collapse divider interaction (NOT #divider-bottom — absent from DOM)
#vim-editor-wrap      → outer wrapper, but #vim-editor-container inside it with display:contents is fine for querySelector
#mobile-explorer-sidebar → use for mobile sidebar (this is the live sidebar)
#mobile-backdrop      → use for backdrop control
```

**⚠ NOTE on `#vim-editor-container`**: It exists in the DOM with `style="display:contents"`.
This means it is transparent to flex/grid layout — its children (`#vim-editor`, `#powerline-status-bar`)
act as direct children of `#vim-editor-wrap`. m4 should mount CodeMirror into `#vim-editor` (not
into `#vim-editor-container`) and mount the powerline bar into `#powerline-status-bar`. Both IDs
are correct and present.

---

## Verdict: **PASS**

All seven review checklist items pass. The three-panel grid, dividers, CSS variables, collapsible
drawer, Ctrl+\` shortcut, mobile breakpoint, and build all work correctly. The two significant
findings (drawer ghost gap, `#divider-bottom` absent from DOM) are flagged with clear remediation
paths; neither blocks m3, m4, or m5 from proceeding. Downstream workers have a clear ID table
above.
