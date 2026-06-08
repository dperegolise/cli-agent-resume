/**
 * ADVERSARIAL TEST: focus_item path attacks and bus.emit gating
 *
 * Reproduces the focus_item handler logic from sseClient.ts (handleSSEEvent).
 * Verifies that validatePath rejects hostile paths AND bus.emit is never called.
 *
 * Critic test — do NOT modify product code.
 */

// ─── Reproduce validatePath ────────────────────────────────────────────────────

const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

function isValidPathFormat(p) {
  return VALID_PATH_RE.test(p);
}

// Simulate entryIndex — only whitelisted paths exist
const entryIndex = new Map([
  ['about.md', { path: 'about.md', title: 'About' }],
  ['projects/project-1.md', { path: 'projects/project-1.md', title: 'Project 1' }],
  ['experience/senior-eng.md', { path: 'experience/senior-eng.md', title: 'Senior Eng' }],
]);

function validatePath(p) {
  if (typeof p !== 'string') return false;
  return isValidPathFormat(p) && entryIndex.has(p);
}

// ─── Simulate handleSSEEvent for focus_item ────────────────────────────────────

let busEmitCalled = false;
let busEmitPayload = null;

// Mock bus
const bus = {
  emit(eventType, payload) {
    busEmitCalled = true;
    busEmitPayload = { eventType, payload };
  }
};

const EVENT_TYPES = { FOCUS_FILE: 'focus:file' };

function simulateFocusItemHandler(focusEvt) {
  busEmitCalled = false;
  busEmitPayload = null;
  const terminalWrites = [];

  const fakeTerminal = {
    writeln(s) { terminalWrites.push(s); }
  };

  // Exact logic from handleSSEEvent case 'focus_item':
  if (focusEvt.error) {
    fakeTerminal.writeln('\r\n' + '\x1b[31m' + `focus_item error: ${focusEvt.error}` + '\x1b[0m');
  } else if (!validatePath(focusEvt.path)) {
    fakeTerminal.writeln('\r\n' + '\x1b[31m' + `Invalid path: ${focusEvt.path}` + '\x1b[0m');
    // log.warn (no-op in test)
  } else {
    bus.emit(EVENT_TYPES.FOCUS_FILE, {
      path: focusEvt.path,
      triggerSource: 'agent',
    });
  }

  return { busEmitCalled, busEmitPayload, terminalWrites };
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

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
  if (!cond) throw new Error(msg ?? 'Assertion failed');
}

// ─── Hostile path attacks ──────────────────────────────────────────────────────

// 1. Path traversal attack
test('Path traversal ../../../etc/passwd: validatePath rejects, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: '../../../etc/passwd', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'validatePath must reject path traversal');
  assert(!busEmitCalled, 'bus.emit must NOT be called for hostile path');
});

// 2. Absolute path attack
test('Absolute path /etc/passwd: validatePath rejects, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: '/etc/passwd', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'validatePath must reject absolute path');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 3. Nonexistent path (valid format, but not in manifest)
test('Nonexistent path nonexistent.md: format valid but not in index, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: 'nonexistent.md', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  // Format is valid — isValidPathFormat returns true — but entryIndex.has returns false
  assert(isValidPathFormat(evt.path), 'Format check should pass for nonexistent.md');
  assert(!validatePath(evt.path), 'Full validatePath must reject (not in index)');
  assert(!busEmitCalled, 'bus.emit must NOT be called for unlisted path');
});

// 4. Empty path
test('Empty path "": validatePath rejects, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: '', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'Empty path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 5. Null path (hostile JSON: path is null)
test('Null path field: validatePath rejects, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: null, error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  // validatePath receives null — our guard: typeof p !== 'string' → false
  assert(!validatePath(evt.path), 'null path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called for null path');
});

// 6. Windows path traversal (backslash — not in allowed charset)
test('Windows path traversal ..\\..\\etc\\passwd: rejected', () => {
  const evt = { type: 'focus_item', path: '..\\..\\etc\\passwd', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'Backslash path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 7. URL-encoded traversal
test('URL-encoded traversal %2e%2e/etc/passwd: rejected', () => {
  const evt = { type: 'focus_item', path: '%2e%2e/etc/passwd', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'URL-encoded path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 8. Null byte injection
test('Null byte injection file\\x00.md: rejected', () => {
  const evt = { type: 'focus_item', path: 'file\x00.md', error: null };
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'Null byte path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 9. Valid path that IS in manifest — bus SHOULD be emitted
test('Valid whitelisted path about.md: validatePath accepts, bus IS emitted', () => {
  const evt = { type: 'focus_item', path: 'about.md', error: null };
  const { busEmitCalled, busEmitPayload } = simulateFocusItemHandler(evt);
  assert(validatePath(evt.path), 'Valid path should be accepted');
  assert(busEmitCalled, 'bus.emit MUST be called for valid path');
  assert(busEmitPayload.eventType === 'focus:file', 'Should emit focus:file event');
  assert(busEmitPayload.payload.path === 'about.md', 'Payload path should match');
  assert(busEmitPayload.payload.triggerSource === 'agent', 'TriggerSource should be agent');
});

// 10. focus_item with error field set — error path takes priority, bus NOT emitted
test('focus_item with error field: shows error message, bus NOT emitted', () => {
  const evt = { type: 'focus_item', path: 'about.md', error: 'File not found on server' };
  const { busEmitCalled, terminalWrites } = simulateFocusItemHandler(evt);
  assert(!busEmitCalled, 'bus.emit must NOT be called when error is set');
  assert(terminalWrites.some(w => w.includes('focus_item error')), 'Should show error message');
});

// 11. REGEX BUG: path "a/.md" passes format check (empty segment before .md)
test('REGRESSION: a/.md passes regex format check (known regex gap)', () => {
  const result = isValidPathFormat('a/.md');
  // Document the known bug: /^[a-z0-9/_-]+\.md$/ allows empty segments between /
  if (result === true) {
    console.log('    KNOWN BUG: "a/.md" passes isValidPathFormat — empty path segment allowed by regex');
    // Even if format passes, entryIndex lookup saves us (not in manifest)
    assert(!validatePath('a/.md'), 'validatePath must still reject: not in entryIndex');
    console.log('    MITIGATED: entryIndex whitelist prevents bus.emit even for regex-bypassing paths');
  } else {
    console.log('    regex correctly rejects "a/.md"');
  }
  // Either way bus won't be emitted — the entryIndex is the real guard
});

// 12. REGEX BUG: //double-slash.md passes format check
test('REGRESSION: //double-slash.md passes regex format check (known regex gap)', () => {
  const result = isValidPathFormat('//double-slash.md');
  if (result === true) {
    console.log('    KNOWN BUG: "//double-slash.md" passes isValidPathFormat');
    assert(!validatePath('//double-slash.md'), 'validatePath must still reject: not in entryIndex');
    console.log('    MITIGATED: entryIndex whitelist prevents bus.emit');
  } else {
    console.log('    regex correctly rejects "//double-slash.md"');
  }
});

// 13. Path with uppercase letters (case-sensitive check)
test('Uppercase path ABOUT.MD: rejected by regex', () => {
  const evt = { type: 'focus_item', path: 'ABOUT.MD', error: null };
  assert(!validatePath(evt.path), 'Uppercase should be rejected');
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 14. Path with protocol prefix (edge case)
test('Path with javascript: prefix: rejected (not in allowed charset)', () => {
  const evt = { type: 'focus_item', path: 'javascript:alert(1)', error: null };
  assert(!validatePath(evt.path), 'javascript: URI must be rejected');
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// 15. focus_item where path field is missing entirely (undefined)
test('focus_item with missing path field (undefined): safely rejected', () => {
  const evt = { type: 'focus_item', error: null }; // no path field
  const { busEmitCalled } = simulateFocusItemHandler(evt);
  assert(!validatePath(evt.path), 'undefined path must be rejected');
  assert(!busEmitCalled, 'bus.emit must NOT be called');
});

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
  process.exit(1);
}
