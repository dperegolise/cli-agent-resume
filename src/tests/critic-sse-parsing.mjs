/**
 * ADVERSARIAL TEST: SSE parsing robustness
 * Reproduces parseSSEBlock and streamSSE logic from sseClient.ts.
 * Tests malformed frames, partial chunks, [DONE], unknown events.
 *
 * Critic test — do NOT modify product code.
 */

// ─── Reproduce sseClient logic ─────────────────────────────────────────────────

/**
 * Exact copy of parseSSEBlock from sseClient.ts
 */
function parseSSEBlock(block) {
  let data = null;
  for (const line of block.split('\n')) {
    if (line.startsWith('data: ')) {
      data = line.slice('data: '.length);
    }
  }
  return data;
}

/**
 * Simulate streamSSE's double-newline splitting & per-block processing.
 * Returns { events, warnings } where events are the results of JSON.parse on each data.
 */
function simulateStreamSSE(rawInput) {
  const parts = rawInput.split('\n\n');
  // Last entry is partial; keep as buffer (we don't test partial tail here — see separate test)
  const blocks = parts.slice(0, -1);

  const events = [];
  const warnings = [];

  for (const block of blocks) {
    const eventData = parseSSEBlock(block);
    if (eventData === null) {
      warnings.push({ reason: 'no_data_field', block });
      continue;
    }
    try {
      const evt = JSON.parse(eventData);
      events.push(evt);
    } catch (parseErr) {
      warnings.push({ reason: 'invalid_json', block, data: eventData, error: parseErr.message });
    }
  }
  return { events, warnings };
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

// ─── SSE Frame Parsing Tests ───────────────────────────────────────────────────

// 1. Normal well-formed frame
test('Well-formed token frame parsed correctly', () => {
  const raw = 'data: {"type":"token","content":"Hello"}\n\n';
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 1, `Expected 1 event, got ${events.length}`);
  assert(events[0].type === 'token', `Expected token, got ${events[0].type}`);
  assert(events[0].content === 'Hello', `Expected Hello, got ${events[0].content}`);
  assert(warnings.length === 0, `Expected 0 warnings, got ${warnings.length}`);
});

// 2. Missing `data:` prefix — should be silently ignored (null from parseSSEBlock)
test('Frame with no data: prefix is silently ignored (no crash)', () => {
  const raw = 'event: token\nid: 1\n\n'; // valid SSE but no data line
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 0, `Expected 0 events, got ${events.length}`);
  assert(warnings.some(w => w.reason === 'no_data_field'), 'Expected no_data_field warning');
});

// 3. Invalid JSON in data field
test('Invalid JSON in data field: logged as warning, does not crash', () => {
  const raw = 'data: {not valid json}\n\n';
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 0, `Expected 0 events, got ${events.length}`);
  assert(
    warnings.some(w => w.reason === 'invalid_json'),
    `Expected invalid_json warning, got: ${JSON.stringify(warnings)}`
  );
});

// 4. Empty data line (`data: `) — produces empty string, JSON.parse('') throws
test('Empty data line (data: ) does not crash, logs warning', () => {
  const raw = 'data: \n\n';
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 0, 'Expected 0 events from empty data');
  assert(warnings.length === 1, `Expected 1 warning, got ${warnings.length}`);
  assert(warnings[0].reason === 'invalid_json', `Expected invalid_json, got ${warnings[0].reason}`);
});

// 5. Unknown event type — handleSSEEvent default: branch (should log warn, return '')
test('Unknown event type silently ignored in handleSSEEvent default branch', () => {
  // This tests the switch default: case in handleSSEEvent
  // We verify via simulation that an event with type "unknown_event" falls to default
  const raw = 'data: {"type":"unknown_event","foo":"bar"}\n\n';
  const { events } = simulateStreamSSE(raw);
  assert(events.length === 1, 'Should parse JSON successfully');
  assert(events[0].type === 'unknown_event', 'Should have unknown type');

  // Simulate handleSSEEvent switch(evt.type) default branch
  let returned = null;
  function handleSSEEvent(evt) {
    switch (evt.type) {
      case 'token': return evt.content;
      case 'focus_item': return '';
      case 'search_results': return '';
      case 'done': return '';
      case 'error': return '';
      default:
        // This is the production default: log.warn and return ''
        returned = 'default_hit';
        return '';
    }
  }
  const result = handleSSEEvent(events[0]);
  assert(result === '', `Expected empty string, got ${JSON.stringify(result)}`);
  assert(returned === 'default_hit', 'Expected default branch to be hit');
});

// 6. data: [DONE] (OpenAI style) — not valid JSON, should produce warning, not crash
test('data: [DONE] produces JSON parse warning (not crash)', () => {
  const raw = 'data: [DONE]\n\n';
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 0, 'Should not produce an event from [DONE]');
  assert(
    warnings.some(w => w.reason === 'invalid_json' && w.data === '[DONE]'),
    `Expected invalid_json warning for [DONE], got: ${JSON.stringify(warnings)}`
  );
});

// 7. Partial frame at chunk boundary — tests that the buffer tail is preserved
test('Partial frame at chunk boundary: tail not processed as complete event', () => {
  // Simulate two chunks arriving: chunk1 splits mid-frame, chunk2 completes it
  let buffer = '';

  // Chunk 1: complete event + start of next
  const chunk1 = 'data: {"type":"token","content":"Hello"}\n\ndata: {"type":"tok';
  buffer += chunk1;
  const parts1 = buffer.split('\n\n');
  buffer = parts1[parts1.length - 1] ?? '';
  const completed1 = parts1.slice(0, -1);

  assert(completed1.length === 1, `Expected 1 completed block, got ${completed1.length}`);
  const d1 = parseSSEBlock(completed1[0]);
  const e1 = JSON.parse(d1);
  assert(e1.content === 'Hello', 'First chunk correctly parsed');
  // Tail is partial
  assert(buffer === 'data: {"type":"tok', `Unexpected buffer tail: ${JSON.stringify(buffer)}`);

  // Chunk 2: finishes the partial frame
  const chunk2 = 'en","content":"World"}\n\n';
  buffer += chunk2;
  const parts2 = buffer.split('\n\n');
  buffer = parts2[parts2.length - 1] ?? '';
  const completed2 = parts2.slice(0, -1);

  assert(completed2.length === 1, `Expected 1 block from chunk2, got ${completed2.length}`);
  const d2 = parseSSEBlock(completed2[0]);
  const e2 = JSON.parse(d2);
  assert(e2.content === 'World', `Expected World, got ${e2.content}`);
});

// 8. Multiple data: lines in one block — only the LAST is used (per SSE spec)
test('Multiple data: lines in one block: last data wins', () => {
  const block = 'data: {"type":"token","content":"first"}\ndata: {"type":"token","content":"last"}';
  const data = parseSSEBlock(block);
  const evt = JSON.parse(data);
  assert(evt.content === 'last', `Expected last, got ${evt.content}`);
  // NOTE: this means the first data line is silently dropped — could lose events
});

// 9. Frame with event: line before data: — data is still extracted
test('Frame with event: line is handled (data extracted correctly)', () => {
  const raw = 'event: token\ndata: {"type":"token","content":"hi"}\n\n';
  const { events } = simulateStreamSSE(raw);
  assert(events.length === 1, 'Should parse event despite event: line');
  assert(events[0].content === 'hi', `Expected hi, got ${events[0].content}`);
});

// 10. Burst of events — 1000 frames processed without memory issue
test('Burst of 1000 token events parsed without error', () => {
  let raw = '';
  for (let i = 0; i < 1000; i++) {
    raw += `data: {"type":"token","content":"tok${i}"}\n\n`;
  }
  const { events, warnings } = simulateStreamSSE(raw);
  assert(events.length === 1000, `Expected 1000 events, got ${events.length}`);
  assert(warnings.length === 0, `Expected 0 warnings, got ${warnings.length}`);
});

// 11. Frame with data: field containing null — JSON parse succeeds but type is unknown
test('data: null parses to null (unknown event type, safely ignored)', () => {
  const raw = 'data: null\n\n';
  const { events } = simulateStreamSSE(raw);
  assert(events.length === 1, 'null is valid JSON');
  assert(events[0] === null, `Expected null event, got ${JSON.stringify(events[0])}`);
  // handleSSEEvent would receive null — the switch default branch handles it (type undefined)
  // VULNERABILITY CHECK: if handleSSEEvent does (evt as {type:string}).type it would be 'undefined'
  // which hits default: and returns '' safely.
});

// 12. Frame with very large content token (potential memory/rendering issue)
test('Very large token content (100KB string) parsed without crash', () => {
  const bigContent = 'A'.repeat(100_000);
  const raw = `data: {"type":"token","content":"${bigContent}"}\n\n`;
  const { events } = simulateStreamSSE(raw);
  assert(events.length === 1, 'Should parse large content');
  assert(events[0].content.length === 100_000, `Expected 100000 chars`);
});

// 13. XSS via token content — content is written raw to terminal via xterm.js
test('XSS payload in token content flows through to terminal write (no sanitization)', () => {
  const xssPayload = '<script>alert("xss")</script>';
  // Use JSON.stringify to properly escape the payload for the SSE data line
  const raw = 'data: ' + JSON.stringify({ type: 'token', content: xssPayload }) + '\n\n';
  const { events } = simulateStreamSSE(raw);
  // xterm.js renders text, not HTML — XSS via script tag is NOT a vector here.
  // But this verifies content is passed through unmodified.
  assert(events.length === 1, 'Should parse XSS payload as event');
  assert(events[0].content === xssPayload, 'Content passes through unmodified');
  // NOTE: xterm.js is canvas-based; HTML injection does not work. Not a vulnerability.
});

// 14. ANSI escape injection via token content — terminal ANSI sequences
test('ANSI escape sequences in token content can affect terminal rendering', () => {
  // An attacker-controlled backend could inject ANSI sequences that reset/clear terminal
  const ansiClear = '\x1b[2J\x1b[H'; // clear screen + cursor home
  const raw = `data: {"type":"token","content":"${ansiClear.replace(/\x1b/g, '\\u001b')}"}\n\n`;
  const { events } = simulateStreamSSE(raw);
  // JSON.parse converts \\u001b back to ESC
  assert(events.length === 1, 'Parses successfully');
  // VULNERABILITY: if backend is compromised, ANSI injection can clear terminal/move cursor
  // This is expected behavior for a terminal emulator — document as informational
  console.log('    NOTE: ANSI injection via token content is a terminal-by-design behavior (informational)');
});

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
  process.exit(1);
}
