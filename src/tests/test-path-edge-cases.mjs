/**
 * Edge-case path tests: subtle bypasses the regex might miss
 * Updated to use the tightened VALID_PATH_RE from FIX 7 (m3-fix):
 *   /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/
 * This rejects leading slashes, empty segments, and segment-starting dashes/underscores.
 */

const VALID_PATH_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/;

function isValidPathFormat(p) {
  if (typeof p !== 'string') return false;
  return VALID_PATH_RE.test(p);
}

// The tightened regex requires each segment to start with [a-z0-9], preventing
// leading slashes, empty segments, and path traversal at the char level.

const edgeCases = [
  // These should all REJECT
  { input: 'a..b/file.md',     expect: false, desc: 'Double dot in segment name (bypass attempt)' },
  // Wait — the regex does NOT include '.', so a..b would fail. Let's confirm.
  { input: '.md',              expect: false, desc: 'Only .md extension, no filename' },
  { input: 'a/.md',           expect: false, desc: 'Slash then .md' },
  { input: '//double-slash.md', expect: false, desc: 'Double slash at start' },
  { input: 'a//b.md',         expect: false, desc: 'Double slash in middle' },
  // These should ACCEPT
  { input: 'a/b.md',          expect: true,  desc: 'Simple two-segment' },
  { input: '123/456.md',      expect: true,  desc: 'Numeric segments' },
];

let pass = 0, fail = 0;
const failures = [];

for (const { input, expect: expected, desc } of edgeCases) {
  const result = isValidPathFormat(input);
  if (result === expected) {
    pass++;
    console.log(`  PASS  [${desc}] input=${JSON.stringify(input)} => ${result}`);
  } else {
    fail++;
    failures.push({ desc, input, expected, result });
    console.error(`  FAIL  [${desc}] input=${JSON.stringify(input)} expected=${expected} got=${result}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);

// Also show what the regex actually accepts/rejects around the double-dot case
console.log('\n--- Regex analysis ---');
const dotTests = ['a.b/file.md', 'a..b/file.md', '..b/file.md', 'a../file.md'];
for (const t of dotTests) {
  console.log(`  ${JSON.stringify(t)} => ${VALID_PATH_RE.test(t)} (expected: false)`);
}

if (fail > 0) process.exit(1);
