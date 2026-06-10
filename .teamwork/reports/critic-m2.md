# Critic Report — m2-layout

**Critic**: Adversarial Testing  
**Branch**: `m2-layout`  
**Target**: `src/layout/responsive.ts` + `src/layout/style.css`  
**Test harness**: `tests/critic-m2-responsive.mjs` (68 assertions across 18 probe categories)  
**Date**: 2026-06-08  
**Result**: 68 passed, **1 genuine vulnerability confirmed**

---

## Executive Summary

The m2-layout implementation is robust under most adversarial conditions. Event listeners don't leak on normal use, DOM resilience is solid, CSS z-index stacking is correct, hidden panels use `display:none` (not `visibility:hidden`), and divider sizes are exactly 1px. However, one real bug was found, two architectural risks were confirmed, and several minor code quality issues were noted.

---

## Vulnerabilities Found

### V1 — **BREAKPOINT MISMATCH: TS uses `max-width: 767px`, CSS uses `max-width: 768px`** *(CONFIRMED, 1px ghost zone)*

**Severity**: Medium — creates an inconsistent state at exactly 768px viewport width.

**Root cause**: In `responsive.ts`:
```ts
const MOBILE_BREAKPOINT = 768;
// ...
this.mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
// → (max-width: 767px)
```

In `style.css`:
```css
@media (max-width: 768px) { ... }
```

**Ghost zone behavior at exactly 768px viewport width**:
- CSS → applies mobile styles (hamburger visible, `#agent-shell` hidden, `#cli-drawer` hidden, `#file-explorer` hidden)
- JS `isMobile()` → returns `false` (MQ doesn't match at 768px)

**Concrete consequence**: At exactly 768px, the hamburger button is visible (CSS mobile), but `MobileLayout.isMobile()` lies to any caller that checks it. The sidebar can still be opened (open() has no `isMobile()` guard), so sidebar functionality works, but callers doing `if (mobile.isMobile()) { ... }` at 768px get wrong answers. If `isMobile()` is consulted to gate mobile-only features, those features silently don't activate while the mobile UI is displayed.

**Reproduction**: Set viewport to exactly 768px. Check `window.matchMedia('(max-width:767px)').matches` (false) vs CSS rendering (mobile styles applied).

**Fix**: Either change CSS to `@media (max-width: 767px)` (match TS) or change TS to `max-width: ${MOBILE_BREAKPOINT}px` (match CSS). The latter is simpler: `this.mq = window.matchMedia('(max-width: 768px)')`.

---

## Architectural Risks Confirmed

### R1 — **No singleton guard on `initLayout()` — HMR listener accumulation** *(CONFIRMED)*

**Probe 9**: Calling `initLayout()` 3 times stacks 3 `DrawerToggle` instances, each registering its own `document.addEventListener('keydown', ...)`. Each Ctrl+\` press then fires 3 toggle events. Net effect: N calls = N toggles per keypress (which for odd N still produces a visible change).

**Reproduction**:
```js
initLayout(); initLayout(); initLayout();
// One Ctrl+` now toggles drawer 3 times (net: 1 change, but 3 DOM mutations)
```

**Severity**: Low in production (initLayout() called once at startup). Medium in development (Vite HMR fast-refresh can re-run module initialization code on hot reload, accumulating listeners across reloads).

**Fix**: Add a module-level singleton guard in `initLayout()`:
```ts
let _instance: { mobile: MobileLayout; drawer: DrawerToggle } | null = null;
export function initLayout() {
  if (_instance) return _instance;
  // ...
}
```

---

### R2 — **Ctrl+\` has no `document.activeElement` guard** *(CONFIRMED)*

**Probe 6**: The `DrawerToggle` keydown listener is attached to `document` with no check for which element has focus. Any `<input>` or `<textarea>` that receives a Ctrl+\` keydown (event bubbles to document) will trigger a drawer toggle.

```ts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '`') {
    e.preventDefault();   // ← e.preventDefault() called even in input context
    this.toggle();
  }
});
```

**Concrete consequence**: If the CLI drawer contains an `<input>` (e.g., for tab completion), pressing Ctrl+\` while typing would collapse the drawer. Paradoxically, `e.preventDefault()` also swallows the backtick in the input.

**Note**: xterm.js uses a `<canvas>` element for rendering and handles its own keyboard events before they reach the DOM. So Ctrl+\` in an actual xterm terminal window likely doesn't bubble to the document keydown handler. However, any other `<input>` or `<textarea>` in the page is affected.

**Fix**: Add a focus guard:
```ts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '`') {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    this.toggle();
  }
});
```

---

## Code Quality Issues (Non-Bugs)

### Q1 — `.sidebar-open` class on `#mobile-explorer-sidebar` is dead CSS
**Probe 15**: `MobileLayout.open()` adds both `.open` and `.sidebar-open` to `#mobile-explorer-sidebar`. CSS has `#mobile-explorer-sidebar.open { transform: translateX(0) }` (works) but NO rule for `#mobile-explorer-sidebar.sidebar-open`. The `.sidebar-open` class is added to the wrong element — it's designed for the legacy `#mobile-sidebar`. This is harmless (sidebar still opens via `.open`), but `.sidebar-open` is dead weight on `#mobile-explorer-sidebar`.

### Q2 — `rgba(255,255,255,0.1)` and `rgba(0,0,0,0.5)` are literal color values
**Probe 11**: The spec says "no hardcoded color hex values" — technically `rgba()` literals are not hex, but they embed color logic in CSS. The backdrop `rgba(0,0,0,0.5)` and hamburger active state `rgba(255,255,255,0.1)` could be CSS variables (`--backdrop-color`, `--active-highlight`) for theme-ability. Currently noted as non-conforming in spirit but not in letter.

### Q3 — Backdrop desync via external sidebar class manipulation
**Probe 16**: If another module removes `.open` from `#mobile-explorer-sidebar` directly (bypassing `MobileLayout.close()`), the backdrop remains visible (`style.display: 'block'`) while `_open` is still `true`. This is a mild encapsulation breach — callers should always use `close()` to close the sidebar. `close()` correctly resolves the desync when called.

### Q4 — Legacy `#hamburger-menu` in HTML gets no event listener
**Probe 17**: `index.html` includes both `#hamburger-btn` (primary) and `#hamburger-menu` (hidden legacy alias). `MobileLayout` picks `#hamburger-btn` via `?? ` and ignores `#hamburger-menu`. This is correct behavior (legacy element intentionally hidden), but `#hamburger-menu` is dead HTML.

---

## Attacks Repelled ✓

| Probe | Attack | Result |
|-------|--------|--------|
| P1 | MQ listener leak on repeated init() | REPELLED — exactly 1 listener per instance |
| P2 | Viewport cycle mobile→desktop→mobile (5 rapid cycles) | REPELLED — state consistent across all cycles |
| P3 | Double open(), double close(), backdrop click | REPELLED — idempotent, no crash |
| P4 | File item/[data-path]/<a> delegation, background click | REPELLED — delegation works correctly |
| P5 | 20/21 rapid drawer toggles | REPELLED — classList is single truth, no desync |
| P7 | External classList manipulation → toggle | REPELLED — classList as truth handles it cleanly |
| P8 | Completely empty DOM (no elements) | REPELLED — all methods survive gracefully |
| P10 | CSS divider sizes | REPELLED — exactly 1px everywhere |
| P11 | Hardcoded hex colors | REPELLED — all via CSS vars (rgba noted separately) |
| P12 | Hidden panels use wrong visibility method | REPELLED — all use `display:none` |
| P13 | z-index stacking order / hamburger coverage | REPELLED — hamburger=1000 > sidebar=999 > backdrop=998 |
| P15 | CSS sidebar open rule missing | REPELLED — `.open` rule correct (`.sidebar-open` dead but harmless) |
| P16 | Backdrop desync | NOTED — external desync possible but close() resolves |
| P17 | Duplicate hamburger | REPELLED — primary element selected, legacy ignored correctly |
| P18 | DrawerToggle #divider-bottom fallback | REPELLED — fallback works |

---

## Coverage Assessment

- **Behavioral (DOM simulation)**: High — 18 probes cover all documented MobileLayout and DrawerToggle behaviors, including edge cases, event delegation, and multiple-instance accumulation.
- **CSS static analysis**: High — pixel sizes, color variable usage, media query existence, z-index ordering, hidden-panel method all verified.
- **Missing coverage** (would require browser/visual testing):
  - Actual CSS layout at 320px/4K/height<400px (requires computed layout engine — jsdom doesn't compute)
  - CSS transition smoothness (`transition: transform 0.2s ease`)
  - Touch events on mobile (JSDOM doesn't fire touch events natively)
  - `overflow: hidden` preventing horizontal scroll at extreme widths (requires computed layout)

---

## Verdict

**1 confirmed bug** (breakpoint mismatch, medium severity), **2 architectural risks** (HMR listener accumulation, Ctrl+\` focus guard), **4 code quality issues**. The core logic is correct and hardened. The breakpoint mismatch should be fixed before production.
