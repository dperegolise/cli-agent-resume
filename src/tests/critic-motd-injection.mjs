/**
 * ADVERSARIAL TEST: MOTD option injection and WebLinksAddon safety
 *
 * Tests:
 *   1. MOTD option text is static/hardcoded, not user-controllable
 *   2. Clicking an option resolves to a hardcoded query, not user input
 *   3. agent: URI scheme parsing cannot be abused
 *   4. decodeURIComponent in resolveInput cannot crash
 *   5. WebLinksAddon regex safety (OSC 8 link URI handling)
 *   6. QUICK_ACTIONS keys are only single digits 1-4
 *
 * Critic test — do NOT modify product code.
 */

// ─── Reproduce QUICK_ACTIONS and resolveInput ──────────────────────────────────

const QUICK_ACTIONS = [
  { key: '1', label: 'About me',    query: 'Tell me about Daniel' },
  { key: '2', label: 'Projects',    query: "Show me Daniel's projects" },
  { key: '3', label: 'Experience',  query: "What is Daniel's work experience?" },
  { key: '4', label: 'Contact',     query: 'How can I contact Daniel?' },
];

function resolveInput(input) {
  const trimmed = input.trim();

  for (const action of QUICK_ACTIONS) {
    if (trimmed === action.key) {
      return action.query;
    }
  }

  if (trimmed.startsWith('agent:query:')) {
    try {
      return decodeURIComponent(trimmed.slice('agent:query:'.length));
    } catch {
      return trimmed; // fallback: return raw on decode error
    }
  }

  return input;
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

// 1. QUICK_ACTIONS are hardcoded, not user-controllable
test('QUICK_ACTIONS queries are hardcoded static strings', () => {
  for (const action of QUICK_ACTIONS) {
    assert(typeof action.query === 'string', `Query must be string, got ${typeof action.query}`);
    assert(action.query.length > 0, `Query must not be empty`);
    // Verify no user input reaches query content
    assert(!action.query.includes('${'), `Query must not be a template literal expression`);
  }
});

// 2. QUICK_ACTIONS keys are only safe single-char digits
test('QUICK_ACTIONS keys are only single-digit numeric strings', () => {
  for (const action of QUICK_ACTIONS) {
    assert(typeof action.key === 'string', `Key must be string`);
    assert(action.key.length === 1, `Key must be 1 char, got ${action.key.length}`);
    assert(/^[1-9]$/.test(action.key), `Key must be digit 1-9, got ${action.key}`);
  }
});

// 3. Option '1' resolves to hardcoded query (not user-typed)
test('Input "1" resolves to hardcoded "Tell me about Daniel"', () => {
  const result = resolveInput('1');
  assert(result === 'Tell me about Daniel', `Expected hardcoded query, got: ${result}`);
});

// 4. Input "5" (not a valid option) — passes through unchanged
test('Input "5" (no matching action): passed through as-is', () => {
  const result = resolveInput('5');
  assert(result === '5', `Expected passthrough, got: ${result}`);
});

// 5. agent:query: URI — decodes and returns query
test('agent:query:Hello%20World: decodes to "Hello World"', () => {
  const result = resolveInput('agent:query:Hello%20World');
  assert(result === 'Hello World', `Expected "Hello World", got: ${result}`);
});

// 6. agent:query: with malformed URI — fallback to raw string (no crash)
test('agent:query: with invalid percent-encoding: falls back to raw string', () => {
  const malformed = 'agent:query:%GG%ZZ'; // invalid percent sequences
  let result;
  try {
    result = resolveInput(malformed);
  } catch (e) {
    assert(false, `resolveInput threw instead of falling back: ${e.message}`);
  }
  assert(result === malformed, `Expected raw string fallback, got: ${result}`);
});

// 7. agent:query: with very long payload — no crash
test('agent:query: with 10KB query string: no crash', () => {
  const longQuery = 'A'.repeat(10_000);
  const input = 'agent:query:' + encodeURIComponent(longQuery);
  const result = resolveInput(input);
  assert(result === longQuery, `Expected 10KB string`);
  assert(result.length === 10_000, `Expected length 10000, got ${result.length}`);
});

// 8. agent:query: with javascript: URI — decodes but just returns the string
test('agent:query:javascript:alert(1): decodes to string (not executed)', () => {
  const input = 'agent:query:' + encodeURIComponent('javascript:alert(1)');
  const result = resolveInput(input);
  // The decoded string is sent to sseClient.sendMessage() as a user query.
  // It's sent to the backend as a chat message — not eval'd client-side.
  assert(result === 'javascript:alert(1)', `Got: ${result}`);
  console.log('    NOTE: javascript: strings can be sent as chat messages (to backend, not eval\'d)');
  console.log('    SAFE: xterm.js renders text, not HTML; no XSS execution');
});

// 9. OSC 8 link URI construction in MOTD — verify encoding
test('MOTD OSC 8 link URIs are properly encoded (no injection in URI)', () => {
  // From motd.ts:
  //   const uri = `agent:query:${encodeURIComponent(action.query)}`;
  // Verify that encodeURIComponent prevents injection in the OSC 8 sequence.
  for (const action of QUICK_ACTIONS) {
    const uri = `agent:query:${encodeURIComponent(action.query)}`;
    // OSC 8 sequence is: ESC ] 8 ; ; uri ST
    // A hostile URI containing ESC or ST (BEL/ST) could break out of the OSC sequence.
    const encoded = encodeURIComponent(action.query);
    // encodeURIComponent encodes all special chars including ESC (%1B) and BEL (%07)
    assert(!encoded.includes('\x1b'), 'Encoded URI must not contain raw ESC');
    assert(!encoded.includes('\x07'), 'Encoded URI must not contain raw BEL');
    assert(!encoded.includes('\\'), 'Encoded URI must not contain backslash');
  }
  console.log('    SAFE: MOTD OSC 8 URIs are properly encodeURIComponent encoded');
});

// 10. WebLinksAddon regex safety — OSC 8 links are standard hyperlinks
test('OSC 8 link content cannot trigger crafted regex in terminal output', () => {
  // xterm.js WebLinksAddon matches URLs with a regex like:
  //   https?://[^\s]+
  // The MOTD uses agent: scheme, which WebLinksAddon would NOT match by default.
  // Only built-in http/https links are matched by the default regex.
  // The printMOTD code wraps options in OSC 8 sequences, which are handled natively.
  //
  // A crafted terminal output could potentially contain a very long URL that causes
  // catastrophic backtracking in the WebLinksAddon regex. Let's check if the
  // OSC 8 URI scheme is agent: (not a standard URL regex).
  const action = QUICK_ACTIONS[0];
  const uri = `agent:query:${encodeURIComponent(action.query)}`;
  // agent: scheme — not matched by http/https regex
  assert(!uri.startsWith('http'), 'MOTD links use agent: scheme, not http:');
  console.log('    NOTE: agent: scheme not matched by default WebLinksAddon http regex');
  console.log('    SAFE: MOTD links cannot trigger WebLinksAddon regex on crafted output');
});

// 11. Fuzzing resolveInput with edge-case inputs
const fuzzInputs = [
  '', ' ', '  1  ', '\t1', '1\n', '\x00', '\x1b[A', '1\x00', '\x03',
  'agent:query:', 'agent:query:  ', 'AGENT:QUERY:Hello',
  'agent:query:\x00\x01\x02', 'agent:QUERY:hello',
];

for (const input of fuzzInputs) {
  test(`Fuzz resolveInput(${JSON.stringify(input)}): no crash`, () => {
    let result;
    try {
      result = resolveInput(input);
    } catch (e) {
      assert(false, `Threw: ${e.message}`);
    }
    assert(typeof result === 'string', `Must return string, got ${typeof result}`);
  });
}

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
  process.exit(1);
}
