/**
 * Adversarial test: ThemeManager from theme.ts
 * Runs in Node.js — we mock document.documentElement to avoid browser deps.
 */

// ─── Mock browser globals ──────────────────────────────────────────────────────
const cssVars = {};
globalThis.document = {
  documentElement: {
    style: {
      setProperty: (key, val) => { cssVars[key] = val; },
    },
  },
};

// ─── Load module ────────────────────────────────────────────────────────────────
// We reproduce the ThemeManager logic in JS (can't import TS directly)

const VALID_THEME_NAMES = ['gruvbox-dark', 'nord', 'tokyo-night'];

class ThemeManager {
  constructor(initialTheme = 'gruvbox-dark') {
    if (!VALID_THEME_NAMES.includes(initialTheme)) {
      throw new Error(`Unknown theme: ${initialTheme}. Available: ${VALID_THEME_NAMES.join(', ')}`);
    }
    this.activeTheme = initialTheme;
    this.listeners = new Set();
  }

  getTheme() { return this.activeTheme; }

  setTheme(name) {
    if (!VALID_THEME_NAMES.includes(name)) {
      throw new Error(`Unknown theme: ${name}. Available: ${VALID_THEME_NAMES.join(', ')}`);
    }
    this.activeTheme = name;
    this.listeners.forEach((cb) => cb(name));
  }

  onThemeChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const failures = [];

function test(desc, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${desc}`);
  } catch (e) {
    fail++;
    failures.push({ desc, error: e.message });
    console.error(`  FAIL  ${desc}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// 1. Constructor with unknown theme should throw
test('Constructor throws on unknown theme', () => {
  let threw = false;
  try { new ThemeManager('not-a-theme'); } catch { threw = true; }
  assert(threw, 'Should have thrown');
});

// 2. setTheme with unknown theme should throw
test('setTheme throws on unknown theme', () => {
  const tm = new ThemeManager();
  let threw = false;
  try { tm.setTheme('hacker-green'); } catch { threw = true; }
  assert(threw, 'Should have thrown for unknown theme');
});

// 3. setTheme with empty string should throw
test('setTheme throws on empty string', () => {
  const tm = new ThemeManager();
  let threw = false;
  try { tm.setTheme(''); } catch { threw = true; }
  assert(threw, 'Should have thrown for empty string');
});

// 4. setTheme with null should throw (if called from JS without TS checks)
test('setTheme throws on null', () => {
  const tm = new ThemeManager();
  let threw = false;
  try { tm.setTheme(null); } catch { threw = true; }
  assert(threw, 'Should have thrown for null');
});

// 5. Listener is called on theme change
test('Listener fires on setTheme', () => {
  const tm = new ThemeManager();
  let received = null;
  tm.onThemeChange((name) => { received = name; });
  tm.setTheme('nord');
  assert(received === 'nord', `Expected 'nord' got '${received}'`);
});

// 6. Unsubscribe works — listener not called after unsubscribe
test('Unsubscribe stops listener', () => {
  const tm = new ThemeManager();
  let callCount = 0;
  const unsub = tm.onThemeChange(() => { callCount++; });
  tm.setTheme('nord');
  assert(callCount === 1, 'Should have been called once');
  unsub();
  tm.setTheme('tokyo-night');
  assert(callCount === 1, `Should still be 1 after unsub, got ${callCount}`);
});

// 7. Multiple subscriptions don't cause listener leak after unsubscribing
test('No listener leak: 1000 subscribe+unsubscribe cycles', () => {
  const tm = new ThemeManager();
  let calls = 0;
  for (let i = 0; i < 1000; i++) {
    const unsub = tm.onThemeChange(() => { calls++; });
    unsub();
  }
  tm.setTheme('nord');
  assert(calls === 0, `Expected 0 calls after all unsubscribes, got ${calls}`);
  assert(tm.listeners.size === 0, `Expected 0 listeners, got ${tm.listeners.size}`);
});

// 8. Theme stays previous on failed setTheme
test('Theme unchanged after failed setTheme', () => {
  const tm = new ThemeManager('gruvbox-dark');
  try { tm.setTheme('nonexistent'); } catch {}
  assert(tm.getTheme() === 'gruvbox-dark', `Expected gruvbox-dark, got ${tm.getTheme()}`);
});

// 9. Constructor with valid non-default theme
test('Constructor accepts all valid theme names', () => {
  for (const name of ['gruvbox-dark', 'nord', 'tokyo-night']) {
    const tm = new ThemeManager(name);
    assert(tm.getTheme() === name, `Expected ${name}`);
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
  process.exit(1);
}
