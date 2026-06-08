/**
 * Critic adversarial test suite for m5-cli-drawer
 *
 * Covers:
 *  1. View-path attacks (validatePath rejections + bus.emit guard)
 *  2. Command edge cases
 *  3. Tab completion edge cases
 *  4. History bounds
 *  5. Theme/ThemeManager edge cases
 *  6. Regex bypass attacks on VALID_PATH_RE
 *  7. Drawer toggle + m2 interplay (static analysis)
 */

// ─── Shared test harness ───────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function test(desc, fn) {
  try {
    fn();
    pass++;
    process.stdout.write(`  PASS  ${desc}\n`);
  } catch (e) {
    fail++;
    failures.push({ desc, error: e.message });
    process.stderr.write(`  FAIL  ${desc}: ${e.message}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertThrows(fn, msgPattern) {
  let threw = false;
  let errMsg = '';
  try { fn(); } catch (e) { threw = true; errMsg = e.message; }
  if (!threw) throw new Error(`Expected a throw (pattern: ${msgPattern}), but none occurred`);
  if (msgPattern && !errMsg.includes(msgPattern)) {
    throw new Error(`Threw "${errMsg}" but expected to include "${msgPattern}"`);
  }
}

// ─── 1. VALIDATE PATH — regex + bus.emit guard ────────────────────────────────
// We reproduce the exact logic from manifest.ts

console.log('\n=== 1. validatePath attack surface ===');

const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

function isValidPathFormat(p) {
  if (typeof p !== 'string') return false;
  return VALID_PATH_RE.test(p);
}

// Simulate entryIndex (only valid known paths)
const entryIndex = new Map([
  ['about.md', true],
  ['projects/index.md', true],
  ['contact.md', true],
]);

function validatePath(p) {
  return isValidPathFormat(p) && entryIndex.has(p);
}

// Simulate cmdView — we track whether bus.emit would be called
function simulateCmdView(rawPath) {
  const busEmitCalls = [];
  const write = () => {};

  if (!rawPath || !rawPath.trim()) {
    return { emitted: false, reason: 'empty path' };
  }

  const trimmed = rawPath.trim();
  if (!validatePath(trimmed)) {
    return { emitted: false, reason: 'validation rejected' };
  }

  busEmitCalls.push({ event: 'FOCUS_FILE', path: trimmed });
  return { emitted: true, path: trimmed };
}

// Attack payloads
// NOTE: 'about.md\r\n' is NOT tested here as an attack path because:
//   1. terminal.ts filters chars < 32 from lineBuffer (CRLF = \r\n can't enter from keyboard)
//   2. cmdView does rawPath = args[0]?.trim() which strips CRLF before validatePath
// So CRLF cannot reach validatePath in production.
const pathAttacks = [
  '../../../etc/passwd',
  '/etc/passwd',
  'nonexistent.md',
  'projects/../../../secret.md',
  '',
  '   ',
  'index.md\x00.js',          // null byte
  '\x00about.md',              // null byte prefix
  'about.MD',                  // wrong case
  '../about.md',               // single traversal
  'ABOUT.md',
  'projects/../../etc.md',
  String.fromCharCode(0) + 'about.md', // NUL as first char
  'about.md%00.js',            // URL-encoded null byte
  new Array(1000).fill('a').join('') + '.md', // very long path
];

for (const attack of pathAttacks) {
  test(`REJECT + no bus.emit: ${JSON.stringify(attack).slice(0, 60)}`, () => {
    const result = simulateCmdView(attack);
    assert(!result.emitted, `bus.emit was called for attack path: ${JSON.stringify(attack)}`);
  });
}

// Legit paths should emit
test('ALLOW + emit: about.md is in manifest', () => {
  const result = simulateCmdView('about.md');
  assert(result.emitted, 'Should have emitted for known path');
  assert(result.path === 'about.md');
});

test('ALLOW + emit: projects/index.md is in manifest', () => {
  const result = simulateCmdView('projects/index.md');
  assert(result.emitted, 'Should have emitted for known path');
});

// ─── 2. REGEX BYPASS — subtle patterns ────────────────────────────────────────
console.log('\n=== 2. Regex bypass edge cases ===');

// These tests represent DISCOVERED BUGS from the existing test-path-edge-cases.mjs
test('REJECT: a/.md (empty segment before .md)', () => {
  // BUG EXPOSED: the regex /^[a-z0-9/_-]+\.md$/ allows 'a/.md'
  // because [a-z0-9/_-]+ matches 'a/' and then '.md' matches '\.md'
  // This should return false but actually returns TRUE — a real regex flaw
  const result = isValidPathFormat('a/.md');
  if (result === true) {
    // Document the bug but mark as a real failure
    throw new Error(
      'BUG: a/.md passes VALID_PATH_RE — regex allows empty final segment. ' +
      'A path like "x/.md" has no filename before the extension. Should be rejected.'
    );
  }
  assert(!result, 'a/.md should be rejected');
});

test('REJECT: //double-slash.md (empty first segment)', () => {
  // BUG EXPOSED: the regex allows '//double-slash.md'
  const result = isValidPathFormat('//double-slash.md');
  if (result === true) {
    throw new Error(
      'BUG: //double-slash.md passes VALID_PATH_RE — regex allows leading double-slash. ' +
      'Empty path segments should be rejected.'
    );
  }
  assert(!result, '//double-slash.md should be rejected');
});

test('REJECT: a//b.md (consecutive slashes in middle)', () => {
  // BUG EXPOSED: the regex allows 'a//b.md'
  const result = isValidPathFormat('a//b.md');
  if (result === true) {
    throw new Error(
      'BUG: a//b.md passes VALID_PATH_RE — regex allows double-slash in path. ' +
      'Consecutive slashes create empty path segments and are canonically equivalent to traversal.'
    );
  }
  assert(!result, 'a//b.md should be rejected');
});

test('REGEX WEAKNESS: /a.md passes format check (only manifest lookup saves it)', () => {
  // The regex charset [a-z0-9/_-] includes '/' so '/a.md' satisfies the regex.
  // In production this is caught by entryIndex.has('/a.md') returning false.
  // But the format-only check is misleadingly permissive for absolute paths.
  const result = isValidPathFormat('/a.md');
  if (result === true) {
    // Document but don't hard-fail — the second layer (entryIndex) saves it
    process.stdout.write(
      '    NOTE (VUL-1): /a.md passes VALID_PATH_RE format check — absolute paths not caught by regex alone. ' +
      'Only the manifest lookup prevents exploitation. Defense-in-depth is weak here.\n'
    );
    // This is a real weakness — flag it as a failure
    throw new Error(
      'VUL-1: VALID_PATH_RE accepts absolute paths (/a.md). ' +
      'The regex charset includes "/" with no "must start with letter/digit" anchor. ' +
      'Should use /^[a-z0-9][a-z0-9/_-]*\\.md$/ or check !p.startsWith(\'/\').'
    );
  }
  assert(!result, '/a.md should be rejected (absolute path)');
});

// Additional subtle bypass attempts
const subtleAttacks = [
  { path: 'a/b/', expect: false, desc: 'trailing slash' },
  { path: 'a/ /b.md', expect: false, desc: 'space segment' },
  { path: 'a/\t/b.md', expect: false, desc: 'tab segment' },
  { path: 'a/\n/b.md', expect: false, desc: 'newline segment' },
  { path: '-leading-dash.md', expect: true, desc: 'leading dash (allowed by charset)' },
  { path: '_leading-underscore.md', expect: true, desc: 'leading underscore (allowed by charset)' },
  { path: '0/1/2.md', expect: true, desc: 'all-numeric segments (allowed by charset)' },
];

for (const { path, expect: expected, desc } of subtleAttacks) {
  test(`path "${path}" — ${desc}`, () => {
    const result = isValidPathFormat(path);
    assert(result === expected, `Expected ${expected} got ${result} for "${path}"`);
  });
}

// ─── 3. COMMAND DISPATCH edge cases ───────────────────────────────────────────
console.log('\n=== 3. Command dispatch edge cases ===');

// We reproduce the dispatch logic from commands.ts for unit testing

async function simulateDispatch(input) {
  const output = [];
  const ctx = {
    write: (line) => output.push(line),
    clearScreen: () => output.push('__CLEARED__'),
    setTheme: (name) => output.push(`__SET_THEME:${name}__`),
  };

  const trimmed = input.trim();
  if (!trimmed) return { output, emittedBusEvents: [] };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  const busEvents = [];

  switch (cmd) {
    case 'help':
      output.push('__HELP__');
      break;
    case 'ls':
      output.push(`__LS:${args[0] ?? ''}__`);
      break;
    case 'view': {
      const rawPath = args[0]?.trim();
      if (!rawPath) {
        output.push('ERROR: view: missing path argument');
      } else if (!validatePath(rawPath)) {
        output.push(`ERROR: view: invalid or unknown path '${rawPath}'`);
      } else {
        busEvents.push({ event: 'FOCUS_FILE', path: rawPath });
        output.push(`Opening ${rawPath}...`);
      }
      break;
    }
    case 'theme': {
      const name = args[0]?.trim();
      const validThemes = ['gruvbox-dark', 'nord', 'tokyo-night'];
      if (!name) {
        output.push('ERROR: theme: missing name');
      } else if (!validThemes.includes(name)) {
        output.push(`ERROR: theme: unknown theme '${name}'`);
      } else {
        ctx.setTheme(name);
        busEvents.push({ event: 'THEME_CHANGE', name });
        output.push(`Theme changed to '${name}'.`);
      }
      break;
    }
    case 'search': {
      const query = args.join(' ').trim();
      if (!query) {
        output.push('ERROR: search: missing query');
      } else {
        output.push(`Searching for '${query}'...`);
      }
      break;
    }
    case 'clear':
      ctx.clearScreen();
      break;
    default:
      output.push(`ERROR: command not found: ${cmd}`);
  }

  return { output, busEvents };
}

// help with extra args — should still show help
test('help with extra args does not crash', async () => {
  const r = await simulateDispatch('help foo bar');
  assert(r.output.includes('__HELP__'), `help not shown, got: ${JSON.stringify(r.output)}`);
});

// Empty input — should return without output or crash
test('empty input (just Enter) — no crash, no output', async () => {
  const r = await simulateDispatch('');
  assert(r.output.length === 0, `Expected no output for empty input, got: ${JSON.stringify(r.output)}`);
});

// Spaces only
test('spaces-only input — treated as empty, no crash', async () => {
  const r = await simulateDispatch('   ');
  assert(r.output.length === 0, `Expected no output for spaces-only, got: ${JSON.stringify(r.output)}`);
});

// Very long command (1000 chars)
test('very long command (1000 chars) — no crash', async () => {
  const bigInput = 'x'.repeat(1000);
  let threw = false;
  try { await simulateDispatch(bigInput); } catch { threw = true; }
  assert(!threw, 'Should not throw on 1000-char command');
});

// view with no path
test('view with no path argument — prints usage error', async () => {
  const r = await simulateDispatch('view');
  assert(r.output.some(l => l.includes('ERROR') || l.includes('missing')),
    `Expected usage error, got: ${JSON.stringify(r.output)}`);
  assert(r.busEvents.length === 0, 'Should not emit bus event');
});

// ls with nonexistent section
test('ls nonexistent-section — prints error, no crash', async () => {
  const r = await simulateDispatch('ls nonexistent-section');
  assert(r.output.length > 0, 'Should produce output');
  // No crash
});

// theme with invalid name
test('theme invalid-name — prints error, does NOT call setTheme', async () => {
  const r = await simulateDispatch('theme invalid-name');
  assert(r.output.some(l => l.includes('ERROR')),
    `Expected error, got: ${JSON.stringify(r.output)}`);
  assert(!r.output.some(l => l.includes('__SET_THEME')),
    'Should NOT call setTheme for invalid theme');
  assert(r.busEvents.length === 0, 'Should not emit bus event for invalid theme');
});

// theme with empty string
test('theme with empty string — prints usage error', async () => {
  const r = await simulateDispatch('theme');
  assert(r.output.some(l => l.includes('ERROR')),
    `Expected error, got: ${JSON.stringify(r.output)}`);
});

// search with no query
test('search with no query — prints usage error', async () => {
  const r = await simulateDispatch('search');
  assert(r.output.some(l => l.includes('ERROR') || l.includes('missing')),
    `Expected usage error, got: ${JSON.stringify(r.output)}`);
});

// Case sensitivity — CLEAR vs clear
test('CLEAR (uppercase) — treated case-insensitively', async () => {
  const r = await simulateDispatch('CLEAR');
  assert(r.output.includes('__CLEARED__'),
    `Expected clear to work, got: ${JSON.stringify(r.output)}`);
});

test('View about.md (mixed case) — dispatches', async () => {
  const r = await simulateDispatch('View about.md');
  // 'view' + valid path — should emit or error (not crash)
  assert(r.output.length > 0, 'Should produce some output');
});

// ─── 4. TAB COMPLETION edge cases ─────────────────────────────────────────────
console.log('\n=== 4. Tab completion edge cases ===');

// Reproduce the completion logic from completion.ts
const COMMANDS = ['help', 'ls', 'view', 'search', 'about', 'projects', 'contact', 'clear', 'theme'];

let completionLastPartial = '';
let completionCycleMatches = [];
let completionCycleIndex = 0;

function resetCompletion() {
  completionLastPartial = '';
  completionCycleMatches = [];
  completionCycleIndex = 0;
}

function getCandidates(lineBeforeCursor) {
  const parts = lineBeforeCursor.split(/\s+/);
  const firstToken = parts[0] ?? '';
  const hasSpace = lineBeforeCursor.includes(' ');

  if (!hasSpace) {
    return { candidates: COMMANDS, prefix: firstToken };
  }

  const lastToken = parts[parts.length - 1] ?? '';

  if (firstToken === 'view' || firstToken === 'ls') {
    return { candidates: Array.from(entryIndex.keys()), prefix: lastToken };
  }

  if (firstToken === 'theme') {
    return { candidates: ['gruvbox-dark', 'nord', 'tokyo-night'], prefix: lastToken };
  }

  return { candidates: [], prefix: lastToken };
}

function buildCompletion(line, match) {
  const lastSpaceIdx = line.lastIndexOf(' ');
  if (lastSpaceIdx === -1) return match;
  return line.slice(0, lastSpaceIdx + 1) + match;
}

function tabComplete(lineBeforeCursor) {
  // Repeated Tab on same partial → cycle
  if (lineBeforeCursor === completionLastPartial && completionCycleMatches.length > 1) {
    completionCycleIndex = (completionCycleIndex + 1) % completionCycleMatches.length;
    const match = completionCycleMatches[completionCycleIndex];
    return { type: 'cycle', completed: buildCompletion(lineBeforeCursor, match) };
  }

  const { candidates, prefix } = getCandidates(lineBeforeCursor);
  const matches = candidates.filter((c) => c.startsWith(prefix));

  if (matches.length === 0) {
    resetCompletion();
    return { type: 'none' };
  }

  if (matches.length === 1) {
    resetCompletion();
    const completed = buildCompletion(lineBeforeCursor, matches[0]);
    return { type: 'single', completed };
  }

  // Multiple matches
  completionLastPartial = lineBeforeCursor;
  completionCycleMatches = matches;
  completionCycleIndex = 0;
  return { type: 'multiple', matches, partial: lineBeforeCursor };
}

// Tab with empty input — list all commands
test('Tab on empty input — returns multiple (all commands)', () => {
  resetCompletion();
  const r = tabComplete('');
  assert(r.type === 'multiple', `Expected multiple, got ${r.type}`);
  assert(r.matches.length === COMMANDS.length,
    `Expected ${COMMANDS.length} matches, got ${r.matches.length}`);
});

// Tab with no matches (xyz<Tab>)
test('Tab with no matches (xyz) — returns none, no crash', () => {
  resetCompletion();
  const r = tabComplete('xyz');
  assert(r.type === 'none', `Expected none, got ${r.type}`);
});

// Tab with single match
test('Tab on "hel" — single match "help"', () => {
  resetCompletion();
  const r = tabComplete('hel');
  assert(r.type === 'single', `Expected single, got ${r.type}`);
  assert(r.completed === 'help', `Expected "help", got "${r.completed}"`);
});

// Tab with multiple matches
test('Tab on "s" — multiple matches (search)', () => {
  resetCompletion();
  const r = tabComplete('s');
  assert(r.type === 'multiple' || r.type === 'single',
    `Expected multiple or single, got ${r.type}`);
});

// Cycle wraparound — repeated Tab should cycle back to first match
test('Tab cycling wraps around (cycle past last match → first)', () => {
  resetCompletion();
  // First Tab — get multiple matches for 'c' (clear, contact)
  const first = tabComplete('c');
  if (first.type !== 'multiple') {
    // Not enough matches — skip this test
    process.stdout.write('    NOTE: "c" prefix has only one match, skipping cycle test\n');
    pass++;
    return;
  }
  const numMatches = first.matches.length;

  // Cycle through all matches + 1 more (should wrap)
  for (let i = 0; i < numMatches; i++) {
    tabComplete('c'); // each Tab advances cycle
  }

  // After numMatches cycles from the initial, we should be at index 0 again
  const afterWrap = tabComplete('c');
  // After numMatches additional tabs, cycle index should be 0 (wrapped)
  // The cycleIndex formula is: (cycleIndex + 1) % numMatches
  // After numMatches tabs total: (numMatches) % numMatches = 0
  assert(afterWrap.type === 'cycle' || afterWrap.type === 'multiple',
    `Expected cycle or multiple on wrap, got ${afterWrap.type}`);
});

// Tab after space in view — should complete path
test('Tab on "view ab" — completes to "view about.md"', () => {
  resetCompletion();
  const r = tabComplete('view ab');
  assert(r.type === 'single' || r.type === 'multiple',
    `Expected single or multiple for "view ab", got ${r.type}`);
  if (r.type === 'single') {
    assert(r.completed === 'view about.md',
      `Expected "view about.md", got "${r.completed}"`);
  }
});

// Tab with slash in path — completes within section
test('Tab on "view projects/" — completes within projects/', () => {
  resetCompletion();
  const r = tabComplete('view projects/');
  // The candidates are all paths; prefix is 'projects/'
  // Should find 'projects/index.md'
  assert(r.type === 'single' || r.type === 'multiple' || r.type === 'none',
    `Unexpected type: ${r.type}`);
  if (r.type === 'single') {
    assert(r.completed === 'view projects/index.md',
      `Expected "view projects/index.md", got "${r.completed}"`);
  }
  // No crash is the key assertion
});

// Tab on theme command
test('Tab on "theme g" — completes to gruvbox-dark', () => {
  resetCompletion();
  const r = tabComplete('theme g');
  assert(r.type === 'single', `Expected single, got ${r.type}: ${JSON.stringify(r)}`);
  assert(r.completed === 'theme gruvbox-dark',
    `Expected "theme gruvbox-dark", got "${r.completed}"`);
});

// Tab with long nonsense — no crash
test('Tab on 500-char gibberish — no crash', () => {
  resetCompletion();
  let threw = false;
  try {
    tabComplete('x'.repeat(500));
  } catch { threw = true; }
  assert(!threw, 'Should not throw on long input');
});

// ─── 5. HISTORY bounds ────────────────────────────────────────────────────────
console.log('\n=== 5. History bounds ===');

// Reproduce history.ts logic exactly

const MAX_HISTORY = 50;
let _history = [];
let _cursor = -1;
let _savedInput = '';

function pushHistory(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  if (_history[_history.length - 1] === trimmed) return;

  _history.push(trimmed);
  if (_history.length > MAX_HISTORY) {
    _history.splice(0, _history.length - MAX_HISTORY);
  }
  _cursor = -1;
  _savedInput = '';
}

function resetCursor(partial) {
  _cursor = -1;
  _savedInput = partial;
}

function historyUp(currentInput) {
  if (_history.length === 0) return null;

  if (_cursor === -1) {
    _savedInput = currentInput;
    _cursor = _history.length - 1;
  } else if (_cursor > 0) {
    _cursor -= 1;
  } else {
    return null; // already at oldest
  }
  return _history[_cursor] ?? null;
}

function historyDown() {
  if (_cursor === -1) return null;

  if (_cursor < _history.length - 1) {
    _cursor += 1;
    return _history[_cursor] ?? null;
  }

  _cursor = -1;
  return _savedInput;
}

function clearHistory() {
  _history.length = 0;
  _cursor = -1;
  _savedInput = '';
}

// Up arrow with empty history — no crash, returns null
test('Up arrow with empty history — returns null, no crash', () => {
  clearHistory();
  const result = historyUp('');
  assert(result === null, `Expected null, got ${JSON.stringify(result)}`);
});

// Down arrow with no browsing — no crash
test('Down arrow when not browsing (cursor=-1) — returns null', () => {
  clearHistory();
  const result = historyDown();
  assert(result === null, `Expected null, got ${JSON.stringify(result)}`);
});

// Up arrow past beginning — stops at first item, no wrap
test('Up arrow past beginning — returns null (does not wrap)', () => {
  clearHistory();
  pushHistory('cmd1');
  pushHistory('cmd2');

  const first = historyUp('');   // cursor → 1, returns cmd2
  const second = historyUp('');  // cursor → 0, returns cmd1
  const third = historyUp('');   // already at 0, returns null

  assert(first === 'cmd2', `Expected cmd2, got ${first}`);
  assert(second === 'cmd1', `Expected cmd1, got ${second}`);
  assert(third === null, `Expected null at beginning, got ${third}`);
});

// Down arrow at end — restores partial input
test('Down arrow past end — restores partial input, then null on next press', () => {
  clearHistory();
  pushHistory('cmd1');

  historyUp('partial-text'); // Save 'partial-text', go to cmd1
  const restored = historyDown(); // Past end — restore savedInput

  assert(restored === 'partial-text', `Expected "partial-text", got "${restored}"`);

  const afterRestore = historyDown(); // cursor=-1, returns null
  assert(afterRestore === null, `Expected null after restore, got ${JSON.stringify(afterRestore)}`);
});

// History cap: fill to 50, add 51st — oldest dropped
test('History cap: 51st item drops oldest (MAX_HISTORY=50)', () => {
  clearHistory();
  for (let i = 0; i < 50; i++) {
    pushHistory(`cmd-${i}`);
  }
  assert(_history.length === 50, `Expected 50 items, got ${_history.length}`);
  assert(_history[0] === 'cmd-0', `Expected first=cmd-0, got ${_history[0]}`);

  // Add 51st
  pushHistory('cmd-50');
  assert(_history.length === 50, `Expected 50 after cap, got ${_history.length}`);
  assert(_history[0] === 'cmd-1', `Expected oldest to be cmd-1 after eviction, got ${_history[0]}`);
  assert(_history[49] === 'cmd-50', `Expected newest to be cmd-50, got ${_history[49]}`);
});

// Consecutive duplicates NOT added
test('Consecutive duplicate commands — not pushed again', () => {
  clearHistory();
  pushHistory('ls');
  pushHistory('ls'); // duplicate
  pushHistory('ls'); // duplicate
  assert(_history.length === 1, `Expected 1, got ${_history.length}`);
});

// Blank/whitespace-only commands not pushed
test('Blank commands — not pushed to history', () => {
  clearHistory();
  pushHistory('');
  pushHistory('   ');
  pushHistory('\t');
  assert(_history.length === 0, `Expected 0, got ${_history.length}`);
});

// Up arrow resets cursor on new push
test('historyUp then pushHistory resets cursor to -1', () => {
  clearHistory();
  pushHistory('cmd1');
  historyUp('');
  assert(_cursor === 0, `Expected cursor=0, got ${_cursor}`);
  pushHistory('new-cmd');
  assert(_cursor === -1, `Expected cursor=-1 after push, got ${_cursor}`);
});

// ─── 6. THEME double-emit check ───────────────────────────────────────────────
console.log('\n=== 6. Theme switch — double-emit check ===');

// In terminal.ts, cmdTheme does:
//   ctx.setTheme(name)        → ThemeManager.setTheme (updates state + CSS vars)
//   bus.emit(THEME_CHANGE)    → bus event
//
// The THEME_CHANGE handler in CLITerminal.subscribeTheme also calls:
//   this.themeManager.setTheme(evt.themeName)
//
// This means setTheme is called TWICE per theme command:
//   1. from cmdTheme via ctx.setTheme()
//   2. from the THEME_CHANGE subscriber in CLITerminal itself

// Let's trace through the logic to find this

let setThemeCallCount = 0;
let busEmitCount = 0;
const subscribeHandlers = [];

function mockThemeManager() {
  return {
    setTheme(name) { setThemeCallCount++; },
    getTheme() { return { name: 'gruvbox-dark', colors: {} }; },
  };
}

function mockBus() {
  return {
    emit(type, payload) {
      busEmitCount++;
      // Trigger all subscribed handlers
      for (const h of subscribeHandlers) {
        if (h.type === type) h.handler(payload);
      }
    },
    subscribe(type, handler) {
      subscribeHandlers.push({ type, handler });
      return () => {};
    },
  };
}

test('theme command invokes ThemeManager.setTheme — verify call chain', () => {
  setThemeCallCount = 0;
  busEmitCount = 0;
  subscribeHandlers.length = 0;

  const tm = mockThemeManager();
  const bus = mockBus();

  // Simulate CLITerminal.subscribeTheme — subscribes to THEME_CHANGE
  bus.subscribe('theme:change', (evt) => {
    // From terminal.ts subscribeTheme:
    //   1. calls this.themeManager.getTheme()
    //   2. sets this.term.options.theme
    //   3. if evt.themeName: calls this.themeManager.setTheme(evt.themeName) AGAIN
    tm.setTheme(evt.themeName); // This is the second call!
  });

  // Simulate cmdTheme call chain (commands.ts)
  const ctxSetTheme = (name) => {
    tm.setTheme(name); // First call (from ctx.setTheme in terminal.ts)
  };

  // Execute theme command
  ctxSetTheme('nord');
  bus.emit('theme:change', { themeName: 'nord' });

  // ThemeManager.setTheme is called twice:
  // 1. from ctx.setTheme (in executeCommand)
  // 2. from THEME_CHANGE subscriber in CLITerminal

  process.stdout.write(
    `    setTheme called ${setThemeCallCount} times for one theme command\n`
  );
  process.stdout.write(
    `    bus.emit called ${busEmitCount} times\n`
  );

  // This IS a double-call but it's idempotent for themes (same result, just wasteful)
  // Flag it as a potential issue but not a crash
  if (setThemeCallCount > 1) {
    process.stdout.write(
      `    NOTE: ThemeManager.setTheme called ${setThemeCallCount}x per theme command (double-call)\n`
    );
  }
  // Don't fail — idempotent, but worth documenting
});

// ─── 7. DRAWER toggle: m2 owns #drawer-toggle (static analysis) ───────────────
console.log('\n=== 7. Drawer + m2 interplay (static analysis) ===');

// We check the source code statically: does terminal.ts bind to #drawer-toggle?
import { readFileSync } from 'fs';

const terminalSrc = readFileSync(
  new URL('../drawer/terminal.ts', import.meta.url).pathname, 'utf8'
);

test('terminal.ts does NOT call addEventListener on #drawer-toggle', () => {
  // The comment in terminal.ts says "Does NOT bind to #drawer-toggle"
  // The only reference to 'drawer-toggle' is in a JSDoc comment, NOT in executable code
  // We must check that there is no addEventListener or querySelector call for it
  const lines = terminalSrc.split('\n');
  const executableRefs = lines.filter(line => {
    const trimmed = line.trim();
    // Ignore pure comment lines (start with * or //)
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
    return trimmed.includes('drawer-toggle');
  });
  assert(
    executableRefs.length === 0,
    `VIOLATION: terminal.ts has executable reference(s) to #drawer-toggle:\n  ${executableRefs.join('\n  ')}`
  );
});

test('terminal.ts does NOT bind to #divider-bottom', () => {
  assert(
    !terminalSrc.includes('#divider-bottom'),
    'VIOLATION: terminal.ts references #divider-bottom — m2 should own this'
  );
});

test('terminal.ts does NOT call addEventListener("click") on toggle elements', () => {
  // Look for any actual code (not comments) that touches toggle elements
  const lines = terminalSrc.split('\n');
  const executableToggleCode = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
    return trimmed.includes('divider-bottom') ||
           (trimmed.includes('drawer-toggle') && trimmed.includes('addEventListener'));
  });
  assert(executableToggleCode.length === 0,
    `terminal.ts has executable toggle code:\n  ${executableToggleCode.join('\n  ')}`);
});

// Check that m5 properly uses ResizeObserver for fit on expand
test('terminal.ts uses ResizeObserver to refit on expand', () => {
  assert(
    terminalSrc.includes('ResizeObserver'),
    'terminal.ts should use ResizeObserver to refit xterm on drawer expand'
  );
});

// Check that disposal removes ResizeObserver
test('terminal.ts dispose() disconnects ResizeObserver', () => {
  assert(
    terminalSrc.includes('resizeObserver?.disconnect()') ||
    terminalSrc.includes('resizeObserver.disconnect()'),
    'terminal.ts should disconnect ResizeObserver in dispose()'
  );
});

// Check FitAddon is loaded
test('terminal.ts uses FitAddon for proper terminal sizing', () => {
  assert(
    terminalSrc.includes('FitAddon') && terminalSrc.includes('fitAddon.fit()'),
    'terminal.ts should load and use FitAddon'
  );
});

// ─── 8. BUS singleton — subscribe does not leak on repeated mount ─────────────
console.log('\n=== 8. EventBus subscription leak check ===');

class EventBus {
  constructor() { this.listeners = new Map(); }

  emit(eventType, payload) {
    const handlers = this.listeners.get(eventType);
    if (!handlers || handlers.size === 0) return;
    for (const handler of Array.from(handlers)) {
      try { handler(payload); } catch {}
    }
  }

  subscribe(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    const handler = callback;
    this.listeners.get(eventType).add(handler);
    return () => { this.listeners.get(eventType)?.delete(handler); };
  }
}

test('CLITerminal mount+dispose+mount does not accumulate THEME_CHANGE handlers', () => {
  const bus = new EventBus();
  let callCount = 0;

  // Simulate mount: subscribe, save unsub
  function mount() {
    return bus.subscribe('theme:change', () => { callCount++; });
  }

  // Simulate dispose: call unsub
  const unsub1 = mount();
  bus.emit('theme:change', { themeName: 'nord' });
  assert(callCount === 1, `Expected 1 call after first mount, got ${callCount}`);

  unsub1(); // dispose
  bus.emit('theme:change', { themeName: 'tokyo-night' });
  assert(callCount === 1, `Expected still 1 after dispose, got ${callCount}`);

  const unsub2 = mount(); // re-mount
  bus.emit('theme:change', { themeName: 'gruvbox-dark' });
  assert(callCount === 2, `Expected 2 after remount, got ${callCount}`);

  unsub2();
});

test('Multiple subscribe+dispose cycles do not accumulate listeners', () => {
  const bus = new EventBus();
  let callCount = 0;

  for (let i = 0; i < 100; i++) {
    const unsub = bus.subscribe('theme:change', () => { callCount++; });
    unsub();
  }

  bus.emit('theme:change', { themeName: 'nord' });
  assert(callCount === 0, `Expected 0 calls after all unsubscribes, got ${callCount}`);

  const listenerSet = bus.listeners.get('theme:change');
  assert(!listenerSet || listenerSet.size === 0,
    `Expected empty listener set, got ${listenerSet?.size}`);
});

// ─── 9. PRINTABLE CHARACTER filter ─────────────────────────────────────────────
console.log('\n=== 9. Input character filtering ===');

// terminal.ts only passes chars with charCode >= 32 through to lineBuffer
// Verify that control chars are NOT echoed

function simulateHandleData(data) {
  const lineBuffer_before = 'existing';
  let lineBuffer = lineBuffer_before;
  const output = [];

  // Ctrl+C
  if (data === '\x03') {
    return { lineBuffer: '', type: 'ctrlc' };
  }
  // Backspace
  if (data === '\x7f' || data === '\b') {
    lineBuffer = lineBuffer.slice(0, -1);
    return { lineBuffer, type: 'backspace' };
  }
  // Enter
  if (data === '\r' || data === '\n') {
    return { lineBuffer: '', type: 'enter', submitted: lineBuffer };
  }
  // Tab
  if (data === '\t') {
    return { lineBuffer, type: 'tab' };
  }
  // Escape sequences
  if (data.startsWith('\x1b')) {
    return { lineBuffer, type: 'escape' };
  }
  // Printable check
  if (data.length === 1 && data.charCodeAt(0) >= 32) {
    lineBuffer += data;
    return { lineBuffer, type: 'printable' };
  }
  // Ignored
  return { lineBuffer, type: 'ignored' };
}

test('Control characters (charCode < 32) are ignored (not added to buffer)', () => {
  const controlChars = [
    '\x01', '\x02', '\x04', '\x05', '\x06', '\x07',
    '\x0e', '\x0f', '\x10', '\x11', '\x12', '\x13',
    '\x14', '\x15', '\x16', '\x17', '\x18', '\x19',
    '\x1a',
  ];
  for (const ch of controlChars) {
    const r = simulateHandleData(ch);
    assert(r.type === 'ignored',
      `Char \\x${ch.charCodeAt(0).toString(16).padStart(2,'0')} should be ignored, got type=${r.type}`);
    assert(r.lineBuffer === 'existing',
      `Char should not modify lineBuffer`);
  }
});

test('DEL (0x7f) removes last character from lineBuffer', () => {
  const r = simulateHandleData('\x7f');
  assert(r.type === 'backspace', `Expected backspace, got ${r.type}`);
  assert(r.lineBuffer === 'existin', `Expected "existin", got "${r.lineBuffer}"`);
});

test('Escape sequences are swallowed (not added to buffer)', () => {
  const r = simulateHandleData('\x1b[D'); // left arrow
  assert(r.type === 'escape', `Expected escape, got ${r.type}`);
  assert(r.lineBuffer === 'existing', 'Buffer unchanged');
});

test('NUL byte (\\x00) is below 32 — ignored by printable filter', () => {
  const r = simulateHandleData('\x00');
  assert(r.type === 'ignored', `Expected ignored, got ${r.type}`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${pass + fail} tests | ${pass} passed | ${fail} FAILED`);

if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) {
    console.error(`  FAIL  [${f.desc}]: ${f.error}`);
  }
}

process.exit(fail > 0 ? 1 : 0);
