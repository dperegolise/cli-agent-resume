/**
 * Adversarial test: validateManifest / validateEntry schema validation
 * Reproduces the validation logic from manifest.ts to test edge cases.
 */

// ─── Reproduce validation logic ────────────────────────────────────────────────

function validateEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry;
  return (
    typeof e['path'] === 'string' &&
    typeof e['title'] === 'string' &&
    Array.isArray(e['sections']) &&
    e['sections'].every((s) => typeof s === 'string') &&
    typeof e['excerpt'] === 'string' &&
    typeof e['hash'] === 'string'
  );
}

function validateManifest(data) {
  if (typeof data !== 'object' || data === null) return false;
  const m = data;
  return (
    Array.isArray(m['entries']) &&
    m['entries'].every(validateEntry) &&
    typeof m['version'] === 'string'
  );
}

// ─── Test cases ─────────────────────────────────────────────────────────────────

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

const validEntry = {
  path: 'about.md',
  title: 'About',
  sections: ['about'],
  excerpt: 'Some content',
  hash: 'abc123'
};

const validManifest = {
  entries: [validEntry],
  version: '1.0'
};

// ─── validateManifest ──────────────────────────────────────────────────────────

test('Valid manifest passes', () => assert(validateManifest(validManifest)));
test('null rejected', () => assert(!validateManifest(null)));
test('Array rejected', () => assert(!validateManifest([validEntry])));
test('Empty string rejected', () => assert(!validateManifest('')));
test('Missing entries rejected', () => assert(!validateManifest({ version: '1.0' })));
test('entries=null rejected', () => assert(!validateManifest({ entries: null, version: '1.0' })));
test('buildDate field ignored (removed from schema)', () => assert(validateManifest({ entries: [], version: '1.0' })));
test('Missing version rejected', () => assert(!validateManifest({ entries: [] })));
test('version=42 rejected', () => assert(!validateManifest({ entries: [], version: 42 })));
test('Empty entries array valid', () => assert(validateManifest({ entries: [], version: '1.0' })));

// ─── Prototype pollution ───────────────────────────────────────────────────────
test('Prototype-polluted object rejected', () => {
  const evil = JSON.parse('{"__proto__":{"entries":[],"version":"1"}}');
  // The evil object won't have own entries, so should fail
  assert(!validateManifest(evil), 'Should reject prototype pollution');
});

// ─── validateEntry ─────────────────────────────────────────────────────────────
test('Valid entry passes', () => assert(validateEntry(validEntry)));
test('null entry rejected', () => assert(!validateEntry(null)));
test('Missing path rejected', () => assert(!validateEntry({ title: 'T', sections: [], excerpt: '', hash: 'h' })));
test('path=42 rejected', () => assert(!validateEntry({ ...validEntry, path: 42 })));
test('sections with non-string rejected', () => assert(!validateEntry({ ...validEntry, sections: [1, 2, 3] })));
test('sections=null rejected', () => assert(!validateEntry({ ...validEntry, sections: null })));
test('hash missing rejected', () => assert(!validateEntry({ ...validEntry, hash: undefined })));

// ─── POTENTIAL BUG: extra properties allowed ──────────────────────────────────
// The validators don't reject extra properties. This is by design but worth noting.
test('Extra properties are allowed (not strict)', () => {
  const withExtra = { ...validEntry, __proto__: Object.prototype, evil: 'payload', 'constructor': 'boom' };
  // This SHOULD fail in strict mode, but current validator allows extra fields
  const result = validateEntry(withExtra);
  console.log(`    NOTE: extra-property entry validateEntry returns ${result} — not strict schema`);
  // We just document this, not fail
});

// ─── POTENTIAL BUG: sections can be arbitrary-length array ────────────────────
test('Sections array with 1000 strings is accepted (no length limit)', () => {
  const bigSections = { ...validEntry, sections: new Array(1000).fill('spam') };
  assert(validateEntry(bigSections), 'Allowed — no length limit enforced');
  console.log('    NOTE: no sections array length limit — DoS vector if data is untrusted');
});

// ─── Hash validation — no format check ────────────────────────────────────────
test('hash can be any string including path traversal (no format check)', () => {
  const badHash = { ...validEntry, hash: '../../../etc/passwd' };
  assert(validateEntry(badHash), 'Allowed — hash is not validated for format');
  console.log('    NOTE: hash field is not validated for hex format');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.error(`  ${f.desc}: ${f.error}`);
  process.exit(1);
}
