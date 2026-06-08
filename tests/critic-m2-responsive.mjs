/**
 * Adversarial test harness for src/layout/responsive.ts (m2-layout)
 * Uses jsdom to simulate DOM environment. Tests run in Node.js directly.
 * Loads compiled JS from dist-test/responsive.js
 */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// ── Load the compiled JS source ────────────────────────────────────────────────
const compiledJS = readFileSync(path.join(rootDir, 'dist-test/responsive.js'), 'utf-8');
const cssSource = readFileSync(path.join(rootDir, 'src/layout/style.css'), 'utf-8');
const tsSource = readFileSync(path.join(rootDir, 'src/layout/responsive.ts'), 'utf-8');

// ── Build a realistic DOM matching index.html ─────────────────────────────────

const FULL_HTML = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="app">
    <div id="agent-shell"></div>
    <div id="divider-vertical"></div>
    <div id="right-panel">
      <div id="file-explorer"></div>
      <div id="divider-horizontal"></div>
      <div id="vim-editor-wrap">
        <div id="vim-editor-container">
          <div id="vim-editor"></div>
          <div id="powerline-status-bar"></div>
        </div>
      </div>
    </div>
    <div id="drawer-toggle"></div>
    <div id="cli-drawer"></div>
  </div>
  <button id="hamburger-btn">☰</button>
  <div id="mobile-explorer-sidebar"></div>
  <div id="mobile-backdrop"></div>
</body>
</html>`;

function createDOM(html = FULL_HTML) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  return dom;
}

/**
 * Patch matchMedia on a dom.window.
 * Returns a factory that captures the created MQL so we can introspect it.
 */
function patchMatchMedia(dom) {
  const mqInstances = [];

  dom.window.matchMedia = function(query) {
    const listeners = [];
    const mql = {
      matches: false,       // default desktop (≥768px)
      media: query,
      _listeners: listeners,
      addEventListener(type, fn) {
        listeners.push({ type, fn });
      },
      removeEventListener(type, fn) {
        const idx = listeners.findIndex(l => l.type === type && l.fn === fn);
        if (idx !== -1) listeners.splice(idx, 1);
      },
      _fire(matches) {
        this.matches = matches;
        listeners.filter(l => l.type === 'change').forEach(l => l.fn({ matches, media: query }));
      }
    };
    mqInstances.push(mql);
    return mql;
  };

  return mqInstances;
}

/**
 * Load MobileLayout and DrawerToggle into a given JSDOM window.
 * Returns { MobileLayout, DrawerToggle, initLayout }.
 * We convert the ESM module to a self-executing function for eval.
 */
function loadModule(dom) {
  // Strip ESM imports/exports — inject via <script> tag (requires runScripts:'dangerously')
  const code = compiledJS
    .replace(/^export\s+/gm, '')
    .replace(/^import\s.+$/gm, '');

  const wrapped = `
${code}
window._MobileLayout = MobileLayout;
window._DrawerToggle = DrawerToggle;
window._initLayout = initLayout;
window._MOBILE_BREAKPOINT = MOBILE_BREAKPOINT;
`;
  const script = dom.window.document.createElement('script');
  script.textContent = wrapped;
  dom.window.document.head.appendChild(script);

  return {
    MobileLayout: dom.window._MobileLayout,
    DrawerToggle: dom.window._DrawerToggle,
    initLayout: dom.window._initLayout,
    MOBILE_BREAKPOINT: dom.window._MOBILE_BREAKPOINT,
  };
}

// ── Test runner helpers ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push({ test: testName, detail });
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 1: Event listener leak on repeated init()
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 1: Event listener leak — single instance init() called once');

{
  const dom = createDOM();
  const mqInstances = patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();

  // Exactly 1 MQ listener should be registered
  const mq = mqInstances[mqInstances.length - 1];
  const changeListeners = mq._listeners.filter(l => l.type === 'change').length;
  assert(changeListeners === 1,
    `Single init() call registers exactly 1 MQ 'change' listener (got ${changeListeners})`);

  // Hamburger gets exactly 1 click listener
  // (We can't count DOM event listeners directly in jsdom, but we verify behavior)
  const hamburger = dom.window.document.getElementById('hamburger-btn');
  const sidebar = dom.window.document.getElementById('mobile-explorer-sidebar');

  hamburger.click();
  assert(ml._open === true, 'Hamburger click opens sidebar (listener correctly registered)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 2: Viewport cycle mobile→desktop→mobile state consistency
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 2: Viewport cycle — open/reset/reopen consistency');

{
  const dom = createDOM();
  const mqInstances = patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();
  const mq = mqInstances[mqInstances.length - 1];

  const sidebar = dom.window.document.getElementById('mobile-explorer-sidebar');
  const backdrop = dom.window.document.getElementById('mobile-backdrop');

  // Open on mobile
  mq._fire(true);
  ml.open();

  assert(ml._open === true, 'After open() on mobile, _open is true');
  assert(sidebar.classList.contains('open'), 'Sidebar has .open class');
  assert(backdrop.style.display === 'block', 'Backdrop visible after open()');

  // Desktop auto-reset via MQ event
  mq._fire(false);

  assert(ml._open === false, 'MQ fires desktop → _open resets to false');
  assert(!sidebar.classList.contains('open'), 'MQ fires desktop → sidebar loses .open');
  assert(backdrop.style.display === 'none', 'MQ fires desktop → backdrop hidden');

  // Mobile again → reopen
  mq._fire(true);
  ml.open();

  assert(ml._open === true, '2nd mobile cycle open() works');
  assert(sidebar.classList.contains('open'), 'Sidebar re-opens on 2nd mobile cycle');
  assert(backdrop.style.display === 'block', 'Backdrop re-appears on 2nd mobile cycle');

  // 5 rapid cycles
  for (let i = 0; i < 5; i++) {
    mq._fire(false);
    mq._fire(true);
    ml.open();
  }
  assert(ml._open === true, '5 rapid MQ cycles: state consistent (open after cycle)');
  mq._fire(false);
  assert(ml._open === false, '5 rapid MQ cycles: state consistent (closed after desktop)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 3: Double open(), double close(), backdrop click
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 3: Mobile sidebar idempotency');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();

  const sidebar = dom.window.document.getElementById('mobile-explorer-sidebar');
  const backdrop = dom.window.document.getElementById('mobile-backdrop');

  // Double open
  ml.open();
  ml.open();

  const openCount = [...sidebar.classList].filter(c => c === 'open').length;
  assert(openCount === 1,
    `Double open() — .open appears exactly once (classList.add is idempotent, got ${openCount})`);
  assert(ml._open === true, 'Double open() — internal _open is true');

  // Double close — should be no-op after first close
  ml.close();
  let threw = false;
  try { ml.close(); } catch (e) { threw = true; }

  assert(!threw, 'Double close() — no crash/exception');
  assert(ml._open === false, 'Double close() — _open stays false');
  assert(backdrop.style.display === 'none', 'Double close() — backdrop remains hidden');

  // Backdrop click
  ml.open();
  backdrop.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === false, 'Backdrop click closes sidebar');
  assert(!sidebar.classList.contains('open'), 'Backdrop click removes .open from sidebar');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 4: File item click while sidebar open closes drawer
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 4: File item click delegation');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();

  const sidebar = dom.window.document.getElementById('mobile-explorer-sidebar');

  // .file-item
  const fileItem = dom.window.document.createElement('div');
  fileItem.className = 'file-item';
  sidebar.appendChild(fileItem);

  ml.open();
  fileItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === false, '.file-item click inside sidebar → closes (delegation works)');

  // [data-path]
  const pathItem = dom.window.document.createElement('span');
  pathItem.setAttribute('data-path', '/src/index.ts');
  sidebar.appendChild(pathItem);

  ml.open();
  pathItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === false, '[data-path] click inside sidebar → closes');

  // <a> tag
  const link = dom.window.document.createElement('a');
  link.href = '#';
  sidebar.appendChild(link);

  ml.open();
  link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === false, '<a> click inside sidebar → closes');

  // Non-file area click (sidebar background) should NOT close
  ml.open();
  const bgDiv = dom.window.document.createElement('div');
  bgDiv.className = 'sidebar-header'; // no .file-item, no [data-path], no <a>
  sidebar.appendChild(bgDiv);
  bgDiv.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === true, 'Non-file area click (sidebar background) does NOT close sidebar');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 5: DrawerToggle — rapid toggle state
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 5: DrawerToggle rapid toggle');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const dt = new dom.window._DrawerToggle();
  dt.init();

  const drawer = dom.window.document.getElementById('cli-drawer');

  // 20 toggles (even) → back to original state (not collapsed)
  for (let i = 0; i < 20; i++) dt.toggle();
  assert(dt.isCollapsed() === false, '20 rapid toggles (even) → NOT collapsed');

  // 21 toggles (odd) → collapsed
  for (let i = 0; i < 21; i++) dt.toggle();
  assert(dt.isCollapsed() === true, '21 rapid toggles (odd) → IS collapsed');

  // isCollapsed() must match classList (no internal state desync possible — classList IS the state)
  assert(
    drawer.classList.contains('collapsed') === dt.isCollapsed(),
    'isCollapsed() matches classList — no desync (classList is single source of truth)'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 6: Keyboard shortcut Ctrl+` — no activeElement guard
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 6: Ctrl+` keyboard shortcut fires in input context');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const dt = new dom.window._DrawerToggle();
  dt.init();

  // Baseline: Ctrl+` toggles from desktop document
  const before = dt.isCollapsed();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: '`', ctrlKey: true, bubbles: true, cancelable: true
  }));
  const after = dt.isCollapsed();

  assert(before !== after, 'Ctrl+` on document toggles drawer (baseline)');

  // Now: simulate it from an <input> element
  const input = dom.window.document.createElement('input');
  input.type = 'text';
  dom.window.document.body.appendChild(input);

  dt.expand(); // known state

  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: '`', ctrlKey: true, bubbles: true, cancelable: true
  }));

  const afterInput = dt.isCollapsed();
  // The listener is on document and has no activeElement guard — event bubbles from input
  // This should toggle (VULNERABILITY: no focus guard)
  assert(afterInput === true,
    '[VULNERABILITY] Ctrl+` from <input> toggles drawer — no activeElement/focus guard',
    'Event bubbles from input to document; no check for document.activeElement'
  );

  console.log('    NOTE: In practice, xterm.js canvas may intercept Ctrl+` before it reaches document,');
  console.log('          but <input> and <textarea> elements will propagate it — potential UX bug');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 7: External classList manipulation → state desync
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 7: DrawerToggle — external .collapsed manipulation');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const dt = new dom.window._DrawerToggle();
  dt.init();

  const drawer = dom.window.document.getElementById('cli-drawer');

  // External code adds .collapsed directly
  drawer.classList.add('collapsed');
  assert(dt.isCollapsed() === true, 'isCollapsed() reflects external .collapsed addition (reads classList)');

  // Toggle after external add
  dt.toggle();
  assert(dt.isCollapsed() === false, 'toggle() after external .collapsed correctly removes it');

  // Click then Ctrl+` — no desync (because classList is the truth)
  const toggleBar = dom.window.document.getElementById('drawer-toggle');
  toggleBar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(dt.isCollapsed() === true, 'Click on drawer-toggle correctly collapses');

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: '`', ctrlKey: true, bubbles: true, cancelable: true
  }));
  assert(dt.isCollapsed() === false, 'Ctrl+` after click correctly expands (no desync)');

  assert(drawer.classList.contains('collapsed') === dt.isCollapsed(),
    'classList and isCollapsed() always agree (single source of truth — classList)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 8: MobileLayout with no DOM elements
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 8: Resilience — completely empty DOM');

{
  const emptyDom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
  });
  patchMatchMedia(emptyDom);
  loadModule(emptyDom);

  let threw = false;
  try {
    const ml = new emptyDom.window._MobileLayout();
    ml.init();
    ml.open();
    ml.close();
    ml.toggleSidebar();
    ml.isMobile();
  } catch (e) {
    threw = true;
    failures.push({ test: 'MobileLayout empty DOM', detail: e.message });
  }
  assert(!threw, 'MobileLayout: all methods survive completely missing DOM');

  let drewThrEw = false;
  try {
    const dt = new emptyDom.window._DrawerToggle();
    dt.init();
    dt.toggle();
    dt.collapse();
    dt.expand();
    dt.isCollapsed();
  } catch (e) {
    drewThrEw = true;
    failures.push({ test: 'DrawerToggle empty DOM', detail: e.message });
  }
  assert(!drewThrEw, 'DrawerToggle: all methods survive completely missing DOM');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 9: Multiple initLayout() calls — listener accumulation on document
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 9: Multiple initLayout() — document keydown listener accumulation');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  // Call initLayout() 3 times (simulates HMR or double-init)
  dom.window._initLayout();
  dom.window._initLayout();
  dom.window._initLayout();

  const drawer = dom.window.document.getElementById('cli-drawer');
  const beforeCollapsed = drawer.classList.contains('collapsed');

  // One Ctrl+` press → should trigger 3 DrawerToggle instances all toggling
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: '`', ctrlKey: true, bubbles: true, cancelable: true
  }));

  const afterCollapsed = drawer.classList.contains('collapsed');

  // 3 toggles: net effect is 1 toggle (odd), so state changes
  const stateChanged = beforeCollapsed !== afterCollapsed;
  assert(stateChanged,
    '[VULNERABILITY] 3x initLayout() → Ctrl+` fires 3 toggles (net odd: state changes as expected)',
    `before=${beforeCollapsed}, after=${afterCollapsed}`
  );

  // More critically: if we toggle twice more (to simulate the HMR risk pattern)
  // 3 listeners → each Ctrl+` press causes 3 toggles, not 1
  const preCheck = drawer.classList.contains('collapsed');
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: '`', ctrlKey: true, bubbles: true, cancelable: true
  }));
  const postCheck = drawer.classList.contains('collapsed');
  // Net of 3 more toggles = 3 (odd) = change
  assert(preCheck !== postCheck,
    '[VULNERABILITY] Each subsequent Ctrl+` in multi-init scenario also causes 3 toggles (confirmed listener stacking)'
  );

  console.log('    SEVERITY: No singleton guard on initLayout(). HMR reloads stack document keydown listeners.');
  console.log('    REPRODUCTION: call initLayout() N times → each Ctrl+` triggers N drawer toggles.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 10: CSS static analysis — divider widths
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 10: CSS — divider pixel sizes');

{
  // Grid column divider
  assert(cssSource.includes('grid-template-columns: 320px 1px 1fr'),
    'CSS: vertical divider column is exactly 1px in grid-template-columns');

  // Grid row divider
  assert(cssSource.includes('grid-template-rows: 1fr 1px 220px'),
    'CSS: horizontal divider row is exactly 1px in grid-template-rows');

  // #divider-vertical explicit width
  const vertBlock = cssSource.match(/#divider-vertical\s*\{[^}]*\}/s)?.[0] || '';
  assert(vertBlock.includes('width: 1px'),
    'CSS: #divider-vertical has explicit width:1px',
    `block: ${vertBlock.trim()}`);

  // #divider-horizontal explicit height
  const horizBlock = cssSource.match(/#divider-horizontal\s*\{[^}]*\}/s)?.[0] || '';
  assert(horizBlock.includes('height: 1px'),
    'CSS: #divider-horizontal has explicit height:1px',
    `block: ${horizBlock.trim()}`);

  // #divider-bottom height
  const bottomBlock = cssSource.match(/#divider-bottom\s*\{[^}]*\}/s)?.[0] || '';
  assert(bottomBlock.includes('height: 1px'),
    'CSS: #divider-bottom has explicit height:1px',
    `block: ${bottomBlock.trim()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 11: CSS — var(--tmux-green) used, no fallback hex
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 11: CSS — color via var(--tmux-green), no inline hex');

{
  const tmuxGreenCount = (cssSource.match(/var\(--tmux-green\)/g) || []).length;
  assert(tmuxGreenCount >= 4,
    `CSS: var(--tmux-green) referenced ≥4 times (found ${tmuxGreenCount})`);

  const tmuxGreenFallbacks = (cssSource.match(/var\(--tmux-green,\s*#[0-9a-fA-F]+\)/g) || []).length;
  assert(tmuxGreenFallbacks === 0,
    'CSS: no fallback hex in var(--tmux-green, ...) — pure CSS variable');

  // Check no literal hex colors in layout rules (strip comments first)
  const noComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');

  // Hex colors that are NOT element IDs (those start with #)
  const hexColorPattern = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  const potentialHex = [];
  let m;
  while ((m = hexColorPattern.exec(noComments)) !== null) {
    // Check context: is it a CSS selector (#id) or a color value?
    const before = noComments.slice(Math.max(0, m.index - 30), m.index).trim();
    // If preceded by color:, background:, border:, etc. it's a color value
    if (/(?:color|background|border|fill|stroke|box-shadow|outline)\s*:\s*$/.test(before)) {
      potentialHex.push(m[0]);
    }
  }

  assert(potentialHex.length === 0,
    'CSS: no hardcoded hex color values in layout rules (all via CSS vars)',
    `found: ${potentialHex.join(', ')}`);

  // rgba(0,0,0,...) check — backdrop uses rgba literal
  const rgbaLiterals = noComments.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/g) || [];
  if (rgbaLiterals.length > 0) {
    console.log(`    NOTE: rgba() literals found (not hex): ${rgbaLiterals.join(', ')}`);
    console.log('    These are for transparency (backdrop) and not strictly forbidden, but noted.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 12: CSS — hidden panels use display:none (not visibility/opacity)
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 12: CSS — hidden panels use display:none on mobile');

{
  const mediaStart = cssSource.indexOf('@media (max-width: 768px)');
  assert(mediaStart !== -1, 'CSS: @media (max-width: 768px) block exists');

  const mediaBlock = cssSource.slice(mediaStart);

  const agentBlock = mediaBlock.match(/#agent-shell\s*\{[^}]*\}/s)?.[0] || '';
  assert(agentBlock.includes('display: none'),
    'CSS: #agent-shell uses display:none on mobile (blocks all interaction/focus)',
    `block: ${agentBlock.trim()}`);

  const cliBlock = mediaBlock.match(/#cli-drawer\s*\{[^}]*\}/s)?.[0] || '';
  assert(cliBlock.includes('display: none'),
    'CSS: #cli-drawer uses display:none on mobile',
    `block: ${cliBlock.trim()}`);

  const fileBlock = mediaBlock.match(/#file-explorer\s*\{[^}]*\}/s)?.[0] || '';
  assert(fileBlock.includes('display: none'),
    'CSS: #file-explorer uses display:none on mobile',
    `block: ${fileBlock.trim()}`);

  // Confirm no visibility:hidden or opacity:0 used for "hiding" in mobile
  const hiddenByVisibility = mediaBlock.match(/visibility:\s*hidden/g) || [];
  const hiddenByOpacity0 = mediaBlock.match(/opacity:\s*0(?!\.\d)/g) || [];

  assert(hiddenByVisibility.length === 0,
    'CSS: no visibility:hidden in mobile block (would still be focusable/interactive)',
    `found: ${hiddenByVisibility.length}`);

  assert(hiddenByOpacity0.length === 0,
    'CSS: no opacity:0 in mobile block (would still be focusable/interactive)',
    `found: ${hiddenByOpacity0.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 13: CSS — z-index stacking order
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 13: CSS — z-index stacking order');

{
  const getZIndex = (selector) => {
    const escaped = selector.replace(/[#.]/g, '\\$&');
    // Try multi-selector blocks like "#hamburger-btn,\n#hamburger-menu"
    const pattern = new RegExp(
      `(?:${selector.replace('#', '#')}[^{]*\\{[^}]*?)z-index:\\s*(\\d+)`, 's'
    );
    return cssSource.match(pattern)?.[1];
  };

  // Parse z-index values
  const hamburgerZ = parseInt(cssSource.match(/#hamburger-btn[^{]*\{[^}]*z-index:\s*(\d+)/s)?.[1] || '0');
  const sidebarZ = parseInt(cssSource.match(/#mobile-explorer-sidebar[^{]*\{[^}]*z-index:\s*(\d+)/s)?.[1] || '0');
  const backdropZ = parseInt(cssSource.match(/#mobile-backdrop\s*\{[^}]*z-index:\s*(\d+)/s)?.[1] || '0');

  console.log(`    z-index values: hamburger=${hamburgerZ}, sidebar=${sidebarZ}, backdrop=${backdropZ}`);

  assert(hamburgerZ > 0, `CSS: hamburger has z-index (${hamburgerZ})`);
  assert(sidebarZ > 0, `CSS: sidebar has z-index (${sidebarZ})`);
  assert(backdropZ > 0, `CSS: backdrop has z-index (${backdropZ})`);

  assert(hamburgerZ > sidebarZ,
    `CSS: hamburger z-index (${hamburgerZ}) > sidebar (${sidebarZ}) — hamburger is on top`,
    'Required so hamburger is clickable even when sidebar is visible');

  assert(sidebarZ > backdropZ,
    `CSS: sidebar z-index (${sidebarZ}) > backdrop (${backdropZ})`,
    'Sidebar must render above its own backdrop');

  assert(hamburgerZ >= 1000,
    `CSS: hamburger z-index (${hamburgerZ}) ≥ 1000 per spec`);

  // Check no other element has z-index > hamburger (would cover it)
  const allZMatches = [...cssSource.matchAll(/z-index:\s*(\d+)/g)];
  const allZValues = allZMatches.map(m => parseInt(m[1]));
  const coveringZ = allZValues.filter(z => z > hamburgerZ);

  assert(coveringZ.length === 0,
    `CSS: no element has z-index > hamburger (${hamburgerZ}) that would cover the hamburger button`,
    `found z-index > ${hamburgerZ}: ${coveringZ.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 14: BREAKPOINT MISMATCH — TS vs CSS
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 14: Breakpoint consistency — TS matchMedia vs CSS @media');

{
  // TS uses MOBILE_BREAKPOINT = 768 → matchMedia('(max-width: 767px)')
  // CSS uses @media (max-width: 768px)
  // At exactly 768px: CSS=mobile, JS isMobile()=false → GHOST STATE

  const tsMQExpr = tsSource.match(/`\(max-width: \$\{MOBILE_BREAKPOINT - (\d+)\}px\)`/)?.[1];
  const tsMQOffset = tsMQExpr ? parseInt(tsMQExpr) : 0;
  const tsMQValue = 768 - tsMQOffset; // 768 - 1 = 767

  const cssMQValue = parseInt(cssSource.match(/@media\s*\(max-width:\s*(\d+)px\)/)?.[1] || '0');

  console.log(`    TS matchMedia threshold: ${tsMQValue}px (max-width)`);
  console.log(`    CSS @media threshold: ${cssMQValue}px (max-width)`);

  if (tsMQValue !== cssMQValue) {
    console.log(`    GHOST ZONE: at exactly ${cssMQValue}px viewport width:`);
    console.log(`      CSS → applies mobile styles (hamburger visible, panels hidden)`);
    console.log(`      TS  → isMobile() returns false (MQ doesn't match at ${cssMQValue}px)`);
    console.log(`      RESULT: hamburger is shown but open() doesn't guard against desktop; sidebar can be opened on "desktop"`);
  }

  assert(tsMQValue === cssMQValue,
    `[VULNERABILITY] BREAKPOINT MISMATCH: TS uses ${tsMQValue}px, CSS uses ${cssMQValue}px`,
    `At exactly ${cssMQValue}px: CSS=mobile, JS isMobile()=false — 1px ghost zone`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 15: CSS sidebar .sidebar-open dead rule
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 15: CSS — sidebar-open class on mobile-explorer-sidebar');

{
  // TS adds both 'open' and 'sidebar-open' to #mobile-explorer-sidebar
  // CSS open rule: #mobile-explorer-sidebar.open → translateX(0) ✓
  // CSS: #mobile-sidebar.sidebar-open → translateX(0) (legacy element) ✓
  // But: no rule for #mobile-explorer-sidebar.sidebar-open

  const explorerOpenRule = (cssSource.match(/#mobile-explorer-sidebar\.open[^{]*\{[^}]*\}/s) || []);
  const explorerSidebarOpenRule = (cssSource.match(/#mobile-explorer-sidebar\.sidebar-open[^{]*\{[^}]*\}/s) || []);

  assert(explorerOpenRule.length > 0,
    'CSS: #mobile-explorer-sidebar.open rule exists (primary sidebar rule)');

  if (explorerSidebarOpenRule.length === 0) {
    console.log('    NOTE: No CSS rule for #mobile-explorer-sidebar.sidebar-open');
    console.log('    TS adds .sidebar-open to mobile-explorer-sidebar, but CSS ignores it.');
    console.log('    Harmless (sidebar still opens via .open rule), but dead code in TS.');
  }
  assert(true, '[NOTED] .sidebar-open on #mobile-explorer-sidebar is CSS dead code (TS adds it unnecessarily)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 16: Backdrop state desync via external sidebar class removal
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 16: Backdrop state desync');

{
  const dom = createDOM();
  patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();

  const sidebar = dom.window.document.getElementById('mobile-explorer-sidebar');
  const backdrop = dom.window.document.getElementById('mobile-backdrop');

  ml.open();
  assert(backdrop.style.display === 'block', 'Backdrop visible after open()');

  // External code removes sidebar classes (simulates another module closing without going through MobileLayout)
  sidebar.classList.remove('open', 'sidebar-open');

  // _open is still true, backdrop is still shown — DESYNC
  assert(ml._open === true, 'After external class removal, _open is still true (desync exists)');
  assert(backdrop.style.display === 'block',
    '[NOTED] Backdrop stays visible after external sidebar class removal — backdrop/state desync possible');

  // close() fixes it
  ml.close();
  assert(!ml._open && backdrop.style.display === 'none',
    'close() resolves desync correctly');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 17: Hamburger duplicate — both #hamburger-btn and #hamburger-menu in HTML
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 17: Duplicate hamburger — MobileLayout picks first, ignores second');

{
  const dom = new JSDOM(`<!DOCTYPE html>
<html><body>
  <div id="cli-drawer"></div>
  <div id="drawer-toggle"></div>
  <button id="hamburger-btn">☰</button>
  <button id="hamburger-menu" style="display:none">☰</button>
  <div id="mobile-explorer-sidebar"></div>
  <div id="mobile-backdrop"></div>
</body></html>`, { url: 'http://localhost/', runScripts: 'dangerously' });

  patchMatchMedia(dom);
  loadModule(dom);

  const ml = new dom.window._MobileLayout();
  ml.init();

  // MobileLayout picks hamburger-btn (first match via ??)
  // hamburger-menu gets no click listener
  const btn = dom.window.document.getElementById('hamburger-btn');
  const menu = dom.window.document.getElementById('hamburger-menu');

  btn.click();
  assert(ml._open === true, '#hamburger-btn click opens sidebar (primary element selected)');

  ml.close();

  // hamburger-menu click should NOT trigger open (no listener on it)
  menu.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert(ml._open === false,
    '#hamburger-menu (legacy/duplicate) click does NOT open sidebar — only first found element gets listener',
    'This means the legacy hamburger-menu button in index.html does nothing (intentionally or not)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 18: DrawerToggle — fallback from #drawer-toggle to #divider-bottom
// ─────────────────────────────────────────────────────────────────────────────
section('PROBE 18: DrawerToggle fallback to #divider-bottom');

{
  const dom = new JSDOM(`<!DOCTYPE html>
<html><body>
  <div id="cli-drawer"></div>
  <div id="divider-bottom"></div>
</body></html>`, { url: 'http://localhost/', runScripts: 'dangerously' });

  patchMatchMedia(dom);
  loadModule(dom);

  const dt = new dom.window._DrawerToggle();
  dt.init();

  const dividerBottom = dom.window.document.getElementById('divider-bottom');
  dividerBottom.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert(dt.isCollapsed() === true,
    '#divider-bottom click collapses drawer (fallback works when #drawer-toggle absent)');
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(65));

if (failures.length > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.test}`);
    if (f.detail) console.log(`     ${f.detail}`);
  });
}

process.exit(failed > 0 ? 1 : 0);
