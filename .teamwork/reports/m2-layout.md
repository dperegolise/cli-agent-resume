# m2-layout — Worker Report

**Branch**: `m2-layout`  
**Commit**: `fff94cb`  
**Date**: 2026-06-08  
**Status**: DONE — build passes, zero TypeScript errors

---

## What was implemented

### A. `src/layout/style.css`
Full-viewport three-panel CSS grid layout:

- `body`: `margin:0; height:100vh; overflow:hidden; font-family: 'JetBrains Mono'...;
  background: var(--bg-main); color: var(--fg-main)` — all color via CSS vars
- `#app`: `display:grid; grid-template-columns: 320px 1px 1fr; grid-template-rows: 1fr 1px 220px; height:100vh`
- `#agent-shell`: `grid-column:1; grid-row:1/4` (full height left sidebar)
- `#divider-vertical`: `grid-column:2; grid-row:1/4; background:var(--tmux-green); width:1px`
- `#right-panel`: `grid-column:3; grid-row:1; display:flex; flex-direction:column`
- `#file-explorer`: `flex-shrink:0; height:25%; overflow-y:auto`
- `#divider-horizontal`: `flex-shrink:0; height:1px; background:var(--tmux-green)`
- `#vim-editor-wrap` + `#vim-editor-container`: `flex:1; display:flex; flex-direction:column; overflow:hidden`
- `#vim-editor`: `flex:1; overflow:hidden`
- `#powerline-status-bar`: `flex-shrink:0; height:26px; border-top:1px solid var(--tmux-green)`
- `#divider-bottom` / `#drawer-toggle`: `grid-column:2/4; grid-row:2; height:1px; background:var(--tmux-green); cursor:row-resize`
- `#cli-drawer`: `grid-column:2/4; grid-row:3; height:220px; transition:height 0.15s ease; overflow:hidden`
- `#cli-drawer.collapsed`: `height:0; overflow:hidden`
- Hamburger + mobile sidebar: hidden on desktop via `display:none`
- `@media (max-width: 768px)`: hides agent-shell, all dividers, file-explorer, cli-drawer; right-panel takes full viewport; hamburger + mobile-explorer-sidebar visible; backdrop toggle via `.visible` class

**Design decisions:**
- All color values consumed from CSS variables (`--bg-main`, `--fg-main`, `--tmux-green`); no raw hex in layout rules
- `#vim-editor-container` also styled as `display:flex; flex-direction:column` as a legacy alias alongside `#vim-editor-wrap` so m4 can use either ID
- Mobile sidebar uses `transform:translateX(-100%)` default, `.open`/`.sidebar-open` to `translateX(0)`; `0.2s ease` transition

### B. `src/layout/responsive.ts`
Two classes exported:

**`MobileLayout`**:
- `MediaQueryList` at `(max-width: 767px)` for resize detection
- Resolves `#hamburger-btn` or `#hamburger-menu` (whichever exists)
- Resolves `#mobile-explorer-sidebar` or `#mobile-sidebar`
- Resolves `#mobile-backdrop`
- `open()`: adds `.open`/`.sidebar-open` to sidebar, shows backdrop
- `close()`: removes classes, hides backdrop
- `toggleSidebar()`: delegates to open/close
- MediaQueryList `change` event: calls `close()` when viewport ≥ 768px
- Delegated click listener on sidebar: closes when `.file-item`, `.nerd-tree-item`, `a`, or `[data-path]` is clicked
- `isMobile()` — returns `mq.matches`

**`DrawerToggle`**:
- Click listener on `#drawer-toggle` (or `#divider-bottom` as fallback): toggles `.collapsed` on `#cli-drawer`
- Global `keydown` listener: `Ctrl+`` ` toggles drawer
- `collapse()`, `expand()`, `isCollapsed()` methods

**`initLayout()`**: convenience function that creates and initialises both instances, returns `{ mobile, drawer }`.

### C. `index.html` updates
- Added `<link rel="stylesheet" href="/src/layout/style.css">` in `<head>`
- Added `<div id="vim-editor-wrap">` wrapping `#vim-editor-container` inside `#right-panel`
- `#vim-editor-container` set to `display:contents` to pass-through flex behaviour (maintains backward compatibility with m4 which targets this ID directly)
- Added `<div id="drawer-toggle" ...>` replacing the plain `#divider-bottom` as the bottom divider (adds role=button, aria-label, tabindex=0)
- Added `<button id="hamburger-btn">☰</button>` (primary mobile hamburger; `#hamburger-menu` retained as hidden legacy element)
- Added `<div id="mobile-explorer-sidebar">` (primary mobile sidebar)
- Added `<div id="mobile-backdrop">` (click-to-close backdrop)
- Kept `#mobile-sidebar` (hidden legacy alias for backward compat)
- Removed the inline `<style>` block that duplicated layout/color rules (those now live in `style.css`); kept only the `:root` CSS custom properties block since Vite inlines the external stylesheet

### D. `src/index.ts` update
- Added `import { initLayout } from './layout/responsive.js'`
- Calls `initLayout()` immediately after `applyThemeCSSVars()` and before panel mounts

---

## What was tested

1. **TypeScript compile (`tsc`)**: passes with zero errors — `strict: true` in tsconfig
2. **Vite build (`vite build`)**: passes, outputs:
   - `dist/assets/main-BNRKduyi.css` (2.78 kB) — minified layout CSS with all CSS-var references intact
   - `dist/assets/main-C6sD3-Up.js` (6.71 kB) — includes MobileLayout, DrawerToggle, initLayout symbols
3. **CSS output inspection**: confirmed no hardcoded hex colors in layout rules; all color references are `var(--...)` 
4. **Bundle content check**: confirmed `hamburger`, `mobile-explorer`, `drawer-toggle`, `collapsed` strings present in JS bundle

---

## Interfaces / contracts touched that other milestones depend on

| ID | What changed | Downstream dependency |
|----|-------------|----------------------|
| `#vim-editor-wrap` | New wrapper div added | m4 may use this ID; `#vim-editor-container` still works (display:contents) |
| `#drawer-toggle` | New element; replaces raw `#divider-bottom` as toggle bar | m5 can attach its own collapse listener to this or `#divider-bottom` |
| `#hamburger-btn` | New element (was `#hamburger-menu` in m1 scaffold) | `MobileLayout` looks up both — no breakage |
| `#mobile-explorer-sidebar` | New element | `MobileLayout` looks up this or legacy `#mobile-sidebar` |
| `#mobile-backdrop` | New element | `MobileLayout` manages show/hide |
| `initLayout()` | Called in `src/index.ts` | Any future index.ts changes should preserve this call |
| `src/layout/style.css` | Now the source of layout truth | m4/m5 CSS should not re-declare `#app` grid or `#right-panel` flex |

---

## What passed / failed

- **PASS**: `npm run build` (tsc + vite build) — zero errors, zero warnings
- **PASS**: CSS custom properties — no hardcoded hex in layout CSS
- **PASS**: drawer `.collapsed` transition — CSS rule verified in minified output
- **PASS**: mobile media query — verified in minified CSS output at `@media (width<=768px)`
- **PASS**: MobileLayout + DrawerToggle exported and bundled
- No runtime visual test performed (no browser available in CI-style worktree build)
