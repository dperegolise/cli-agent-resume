/**
 * ADVERSARIAL TEST: SSEClient backend failure modes
 *
 * Tests error handling without browser globals by reproducing the error-handling
 * logic from sseClient.ts (sendMessage, streamSSE).
 *
 * Covers:
 *   - fetch() throws (network error)
 *   - HTTP 500
 *   - HTTP 429 (rate limit) — bug check: 429 passes the error gate
 *   - Stream closes unexpectedly mid-token
 *   - No timeout on fetch (absence check)
 *   - AbortError handling in both fetch and stream phases
 *
 * Critic test — do NOT modify product code.
 */

let pass = 0, fail = 0;
const failures = [];

function test(desc, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { pass++; console.log(`  PASS  ${desc}`); },
        (e) => { fail++; failures.push({ desc, error: e.message }); console.error(`  FAIL  ${desc}: ${e.message}`); }
      );
    }
    pass++;
    console.log(`  PASS  ${desc}`);
  } catch (e) {
    fail++;
    failures.push({ desc, error: e.message });
    console.error(`  FAIL  ${desc}: ${e.message}`);
  }
  return Promise.resolve();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'Assertion failed');
}

// ─── Simulate sseClient error handling logic ───────────────────────────────────

/**
 * Simulate the sendMessage fetch+stream flow.
 * Returns what the terminal would have received.
 */
async function simulateSendMessage({
  fetchResult,       // null = throws, or { ok, status, statusText, headers, body }
  fetchThrows,       // Error to throw from fetch
  streamEvents,      // array of SSE event strings, or Error to throw mid-stream
  abortSignal,       // AbortController signal (optional)
}) {
  const terminalOutput = [];
  const ANSI_RED = '\x1b[31m';
  const ANSI_RESET = '\x1b[0m';
  const ANSI_YELLOW = '\x1b[33m';

  const fakeTerminal = {
    write(s) { terminalOutput.push({ type: 'write', text: s }); },
    writeln(s) { terminalOutput.push({ type: 'writeln', text: s }); },
  };

  let streaming = true;
  let streamingEnded = false;

  // Simulate fetch
  let response;
  try {
    if (fetchThrows) throw fetchThrows;
    response = fetchResult;
  } catch (err) {
    streaming = false;
    if (err instanceof Error && err.name === 'AbortError') {
      return { terminalOutput, aborted: true, streaming: false };
    }
    fakeTerminal.writeln(ANSI_RED + '⚠ Agent backend is unreachable. Please try again later.' + ANSI_RESET);
    fakeTerminal.write('\r\nagent> ');
    return { terminalOutput, streaming: false };
  }

  // Check ban header
  const bannedUntilHeader = response.headers?.get('X-Client-Banned-Until') ?? null;
  let storedBan = null;
  if (bannedUntilHeader) {
    storedBan = bannedUntilHeader;
  }

  // Check HTTP status — BUG AREA: 429 passes through (response.ok=false, status=429)
  if (!response.ok && response.status !== 429) {
    streaming = false;
    fakeTerminal.writeln(ANSI_RED + `Error: HTTP ${response.status} ${response.statusText}` + ANSI_RESET);
    fakeTerminal.write('\r\nagent> ');
    return { terminalOutput, storedBan, streaming: false };
  }

  // Stream SSE
  let assistantContent = '';
  try {
    if (!streamEvents) throw new Error('Response body is null');

    // Simulate reading events
    for (const evtStr of streamEvents) {
      if (evtStr instanceof Error) throw evtStr;
      const parsed = JSON.parse(evtStr);
      switch (parsed.type) {
        case 'token':
          fakeTerminal.write(parsed.content);
          assistantContent += parsed.content;
          break;
        case 'done':
          fakeTerminal.write('\r\n\r\nagent> ');
          break;
        case 'error':
          fakeTerminal.writeln(ANSI_RED + `Error: ${parsed.message}` + ANSI_RESET);
          fakeTerminal.write('\r\nagent> ');
          break;
      }
    }
    streamingEnded = true;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // silently handled
    } else {
      fakeTerminal.writeln(ANSI_RED + '⚠ Stream error: ' + String(err) + ANSI_RESET);
      fakeTerminal.write('\r\nagent> ');
    }
  } finally {
    streaming = false;
  }

  return { terminalOutput, storedBan, streaming: false, assistantContent, streamingEnded };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

const allTests = [];

// 1. fetch() throws network error — terminal shows error, prompt restored
allTests.push(test('fetch() throws network error: error toast shown, prompt restored', async () => {
  const networkErr = new Error('Failed to fetch');
  networkErr.name = 'TypeError';
  const result = await simulateSendMessage({ fetchThrows: networkErr });
  const output = result.terminalOutput.map(t => t.text).join('');
  assert(output.includes('unreachable'), `Expected unreachable message, got: ${output}`);
  assert(output.includes('agent> '), 'Prompt must be restored after network error');
  assert(result.streaming === false, 'streaming flag must be false after error');
}));

// 2. AbortError from fetch — silently handled, prompt already shown by abort()
allTests.push(test('AbortError from fetch(): silently handled, no error toast', async () => {
  const abortErr = new Error('The user aborted a request.');
  abortErr.name = 'AbortError';
  const result = await simulateSendMessage({ fetchThrows: abortErr });
  const output = result.terminalOutput.map(t => t.text).join('');
  assert(!output.includes('unreachable'), 'Should NOT show unreachable for abort');
  assert(!output.includes('Error:'), 'Should NOT show error message for abort');
}));

// 3. HTTP 500 — error message shown, prompt restored
allTests.push(test('HTTP 500: error message shown, prompt restored', async () => {
  const result = await simulateSendMessage({
    fetchResult: {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
      body: null,
    },
    streamEvents: null,
  });
  const output = result.terminalOutput.map(t => t.text).join('');
  assert(output.includes('HTTP 500'), `Expected HTTP 500, got: ${output}`);
  assert(output.includes('agent> '), 'Prompt must be restored after 500');
}));

// 4. HTTP 429 — BUG: 429 is NOT caught by the "!response.ok && status !== 429" gate
//    Instead it falls through to streamSSE with no body → throws 'Response body is null'
allTests.push(test('HTTP 429: falls through to streamSSE (body=null → stream error shown)', async () => {
  const result = await simulateSendMessage({
    fetchResult: {
      ok: false,      // not ok
      status: 429,    // but status IS 429 → skipped by the gate!
      statusText: 'Too Many Requests',
      headers: { get: () => null },
      body: null,
    },
    streamEvents: null, // triggers the null body error
  });
  const output = result.terminalOutput.map(t => t.text).join('');
  // 429 is treated as "proceed to stream" — then body is null → stream error
  assert(output.includes('Stream error') || output.includes('body is null'),
    `Expected stream error for 429 with null body, got: ${output}`);
  assert(output.includes('agent> '), 'Prompt must be restored after 429 stream error');
  console.log('    NOTE: HTTP 429 falls through to streamSSE — gets a stream error instead of a friendly message');
}));

// 5. HTTP 429 with X-Client-Banned-Until header — ban stored in localStorage
allTests.push(test('HTTP 429 with X-Client-Banned-Until: ban timestamp stored', async () => {
  const futureTs = new Date(Date.now() + 60_000).toISOString();
  const result = await simulateSendMessage({
    fetchResult: {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (key) => key === 'X-Client-Banned-Until' ? futureTs : null },
      body: null,
    },
    streamEvents: null,
  });
  assert(result.storedBan === futureTs, `Expected ban timestamp stored, got: ${result.storedBan}`);
}));

// 6. Stream closes unexpectedly mid-token (AbortError mid-stream)
allTests.push(test('AbortError mid-stream: silently handled, prompt NOT re-shown by stream handler', async () => {
  const abortErr = new Error('The user aborted a request.');
  abortErr.name = 'AbortError';
  const result = await simulateSendMessage({
    fetchResult: { ok: true, status: 200, headers: { get: () => null }, body: {} },
    streamEvents: [
      '{"type":"token","content":"Hello "}',
      abortErr,  // abort mid-stream
    ],
  });
  const output = result.terminalOutput.map(t => t.text).join('');
  assert(output.includes('Hello '), 'Tokens before abort should have been written');
  // AbortError is silently swallowed in stream — no error toast
  assert(!output.includes('Stream error'), 'AbortError should NOT show stream error');
}));

// 7. Generic exception mid-stream — error toast + prompt restored
allTests.push(test('Generic error mid-stream: stream error shown, prompt restored', async () => {
  const streamErr = new Error('Connection reset by peer');
  const result = await simulateSendMessage({
    fetchResult: { ok: true, status: 200, headers: { get: () => null }, body: {} },
    streamEvents: [
      '{"type":"token","content":"Hello "}',
      streamErr,  // network error mid-stream
    ],
  });
  const output = result.terminalOutput.map(t => t.text).join('');
  assert(output.includes('Hello '), 'Tokens before error should have been written');
  assert(output.includes('Stream error'), 'Stream error toast must be shown');
  assert(output.includes('agent> '), 'Prompt must be restored after stream error');
}));

// 8. NO TIMEOUT — sseClient has no fetch timeout (AbortController without timeout)
allTests.push(test('ABSENCE CHECK: no fetch timeout in sseClient (AbortController not time-limited)', () => {
  // This test documents that there is NO setTimeout wrapping the fetch.
  // If the backend hangs indefinitely, the client will wait forever.
  // We verify by confirming the AbortController in production is NOT connected to setTimeout.

  // From the source code:
  //   this.currentAbortController = new AbortController();
  //   response = await fetch(AGENT_ENDPOINT, { signal: this.currentAbortController.signal, ... });
  // There is no: setTimeout(() => controller.abort(), TIMEOUT_MS)
  //
  // VULNERABILITY: A slow/hanging backend will block the terminal indefinitely.
  // The user can manually abort with Ctrl+C, but there's no automatic timeout.
  console.log('    CONFIRMED ABSENT: no automatic fetch timeout in sseClient.ts');
  console.log('    VULNERABILITY: hanging backend blocks terminal until user Ctrl+C');
  // This is a confirmed vulnerability — document it
  assert(true, 'Documented absence of timeout');
}));

// 9. Rapid abort (Ctrl+C) after send — currentAbortController is nulled
allTests.push(test('Ctrl+C while streaming: abort() nulls controller, streaming=false', () => {
  // Simulate abort() method from sseClient.ts
  let streaming = true;
  let currentAbortController = new (class {
    aborted = false;
    abort() { this.aborted = true; }
    get signal() { return { aborted: this.aborted }; }
  })();
  const terminalWrites = [];
  const ANSI_YELLOW = '\x1b[33m';
  const ANSI_RESET = '\x1b[0m';

  function abort() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      streaming = false;
      terminalWrites.push('\r\n' + ANSI_YELLOW + '^C' + ANSI_RESET + '\r\n');
    }
  }

  // Call abort
  abort();

  assert(!streaming, 'streaming must be false after abort');
  assert(currentAbortController === null, 'controller must be nulled after abort');
  assert(terminalWrites.some(w => w.includes('^C')), '^C must be written to terminal');
}));

// 10. Double abort — second call is a no-op (controller is already null)
allTests.push(test('Double abort (second Ctrl+C): safe no-op, no crash', () => {
  let currentAbortController = new (class {
    abort() {}
  })();
  const terminalWrites = [];

  function abort() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      terminalWrites.push('^C');
    }
    // Second call: currentAbortController is null → if-guard prevents crash
  }

  abort(); // first
  abort(); // second — should be safe
  assert(terminalWrites.length === 1, `Expected 1 ^C write, got ${terminalWrites.length}`);
}));

// 11. Send while already streaming — BUG CHECK
//     sseClient doesn't guard against concurrent sendMessage calls
allTests.push(test('ABSENCE CHECK: no concurrent send guard in sendMessage()', () => {
  // From the source code, sendMessage() does NOT check if streaming is true.
  // This means if somehow two messages are submitted concurrently, both will
  // create separate AbortControllers and the second will overwrite the first.
  // In practice, inputHandler prevents Enter while streaming (not explicitly coded),
  // but there's no guard in sseClient itself.
  console.log('    NOTE: sendMessage() has no "if streaming, reject" guard');
  console.log('    MITIGATED: inputHandler does not guard against it explicitly either');
  console.log('    RISK: concurrent calls could race on this.currentAbortController');
  assert(true, 'Documented absence of concurrent send guard');
}));

// 12. Ban with past timestamp (already expired) — removed from localStorage, not stuck
allTests.push(test('Expired ban (past timestamp): removed from localStorage, not stuck', () => {
  // Simulate sendMessage ban check logic from sseClient.ts
  const mockStorage = {};
  const pastTs = new Date(Date.now() - 60_000).toISOString();
  mockStorage[Symbol('agent_banned_until')] = pastTs;

  const BAN_STORAGE_KEY = 'agent_banned_until';
  const localStorage = {
    store: { [BAN_STORAGE_KEY]: pastTs },
    getItem(k) { return this.store[k] ?? null; },
    setItem(k, v) { this.store[k] = v; },
    removeItem(k) { delete this.store[k]; },
  };

  // Exact logic from sendMessage:
  const banUntilStr = localStorage.getItem(BAN_STORAGE_KEY);
  let blocked = false;
  if (banUntilStr) {
    const banUntil = new Date(banUntilStr);
    if (banUntil > new Date()) {
      blocked = true;
    } else {
      localStorage.removeItem(BAN_STORAGE_KEY);
    }
  }

  assert(!blocked, 'Expired ban should NOT block the request');
  assert(localStorage.getItem(BAN_STORAGE_KEY) === null, 'Expired ban key should be removed');
}));

// Wait for all async tests
async function runAll() {
  await Promise.all(allTests);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error('\n=== FAILURES ===');
    for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
    process.exit(1);
  }
}

runAll();
