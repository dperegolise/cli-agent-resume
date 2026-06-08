/**
 * Adversarial test: validatePath logic from manifest.ts
 * Runs the same regex + logic in isolation — no browser/fetch needed.
 *
 * We reproduce the logic here exactly as coded so we can test edge cases
 * that the normal build flow never exercises.
 */

// ─── Reproduce module logic ────────────────────────────────────────────────────

/** Exact copy from manifest.ts */
const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

function isValidPathFormat(p) {
  return VALID_PATH_RE.test(p);
}

/**
 * Simulated validatePath that only checks format (no live index).
 * In production, validatePath ALSO checks entryIndex.has(p).
 * We isolate the format check first, then test the full flow.
 */
function validatePathFormat(p) {
  if (typeof p !== 'string') return false; // guard for non-string
  return isValidPathFormat(p);
}

// ─── Test cases ────────────────────────────────────────────────────────────────

const cases = [
  // Should REJECT
  { input: '../../../etc/passwd',    expect: false, desc: 'Path traversal with ../' },
  { input: '/etc/passwd',            expect: false, desc: 'Absolute path' },
  { input: '',                       expect: false, desc: 'Empty string' },
  { input: '   ',                    expect: false, desc: 'Whitespace-only' },
  { input: 'UPPERCASE.md',           expect: false, desc: 'Uppercase letters' },
  { input: 'file.MD',                expect: false, desc: 'Uppercase extension' },
  { input: 'file.txt',               expect: false, desc: 'Non-.md extension' },
  { input: 'projects/../about.md',   expect: false, desc: 'Path traversal in middle' },
  { input: '%2e%2e/etc/passwd',      expect: false, desc: 'URL-encoded traversal' },
  { input: 'file\x00.md',            expect: false, desc: 'Null byte injection' },
  { input: '.hidden.md',             expect: false, desc: 'Dotfile (starts with dot)' },
  { input: 'file .md',               expect: false, desc: 'Space in path' },
  { input: null,                     expect: false, desc: 'null input' },
  { input: undefined,                expect: false, desc: 'undefined input' },
  { input: 42,                       expect: false, desc: 'Number input' },
  { input: {},                       expect: false, desc: 'Object input' },

  // Should ACCEPT
  { input: 'about.md',              expect: true,  desc: 'Simple root file' },
  { input: 'projects/project-1.md', expect: true,  desc: 'One level deep' },
  { input: 'a/b/c/deep.md',         expect: true,  desc: 'Three levels deep' },
  { input: 'my-project-2024.md',    expect: true,  desc: 'Dashes and digits' },
  { input: 'experience/role_1.md',  expect: true,  desc: 'Underscore in name' },
];

// ─── Runner ────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

for (const { input, expect: expected, desc } of cases) {
  const result = validatePathFormat(input);
  if (result === expected) {
    pass++;
    console.log(`  PASS  [${desc}] input=${JSON.stringify(input)}`);
  } else {
    fail++;
    failures.push({ desc, input, expected, result });
    console.error(`  FAIL  [${desc}] input=${JSON.stringify(input)} expected=${expected} got=${result}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);

if (failures.length > 0) {
  console.error('\n=== FAILURES ===');
  for (const f of failures) {
    console.error(`  ${f.desc}: input=${JSON.stringify(f.input)} expected=${f.expected} got=${f.result}`);
  }
  process.exit(1);
} else {
  console.log('All path validation tests passed.');
  process.exit(0);
}
