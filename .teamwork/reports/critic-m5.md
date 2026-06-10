# Critic Report: m5-cli-drawer

**Critic:** adversarial testing session
**Branch tested:** m5-cli-drawer
**Test file:** `src/tests/critic-adversarial-m5.mjs`
**Run:** `node src/tests/critic-adversarial-m5.mjs`
**Result:** 65 passed / 4 FAILED — **4 real vulnerabilities found**

---

## Summary

| Category | Tests | Passed | Failed |
|---|---|---|---|
| 1. View path attacks | 17 | 17 | 0 |
| 2. Regex bypass edge cases | 11 | 7 | 4 |
| 3. Command dispatch edge cases | 11 | 11 | 0 |
| 4. Tab completion edge cases | 9 | 9 | 0 |
| 5. History bounds | 8 | 8 | 0 |
| 6. Theme double-emit (documentation) | 1 | 1 | 0 |
| 7. Drawer + m2 interplay | 6 | 6 | 0 |
| 8. EventBus subscription leak | 2 | 2 | 0 |
| 9. Input character filtering | 4 | 4 | 0 |
| **Total** | **69** | **65** | **4** |

---

## Vulnerabilities Found

### VUL-1: `VALID_PATH_RE` accepts absolute paths (e.g., `/a.md`)

**Severity:** Medium (mitigated by second layer, but defense-in-depth is weak)

**Location:** `src/manifest.ts`, `VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/`

**Reproduction:**
```js
const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;
VALID_PATH_RE.test('/a.md')      // → true (should be false!)
VALID_PATH_RE.test('/etc/passwd.md')  // → true (should be false!)
```

**Root cause:** The character class `[a-z0-9/_-]` includes `/`. Since the regex does not anchor the first character to `[a-z0-9]`, a leading slash is accepted.

**Blast radius:** In production, `validatePath` also checks `entryIndex.has(p)`, which returns `false` for any absolute path (since the manifest only stores relative paths like `about.md`). The manifest lookup is the real guard. But the format-level rejection is the stated purpose of `isValidPathFormat` — it should reject absolute paths at that layer.

**Fix:** `const VALID_PATH_RE = /^[a-z0-9][a-z0-9/_-]*\.md$/;`

---

### VUL-2: `VALID_PATH_RE` accepts empty path segments (e.g., `a/.md`, `a//b.md`, `//x.md`)

**Severity:** Low (mitigated by manifest lookup, but structurally wrong)

**Location:** `src/manifest.ts`, `VALID_PATH_RE`

**Reproduction:**
```js
VALID_PATH_RE.test('a/.md')         // → true (empty filename before extension)
VALID_PATH_RE.test('a//b.md')       // → true (consecutive slashes)
VALID_PATH_RE.test('//double.md')   // → true (double-slash prefix)
```

**Root cause:** The `+` quantifier on `[a-z0-9/_-]` allows any sequence including consecutive slashes. There is no check that each path segment has non-zero length.

**Blast radius:** Structurally malformed paths (empty segments) should not match a format validator. Although none of these will be in the manifest, canonicalisation edge cases (`//` as root, empty segments) are accepted at the format layer.

**Fix:**
```js
// Reject empty segments: validate each segment is non-empty
const VALID_PATH_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.md$/;
```
Or use the two-layer check:
```js
function isValidPathFormat(p: string): boolean {
  if (!VALID_PATH_RE.test(p)) return false;
  // Extra: reject paths with empty segments or leading slash
  const segments = p.slice(0, p.lastIndexOf('.')).split('/');
  return segments.every(s => s.length > 0);
}
```

---

### VUL-3 (informational): `ThemeManager.setTheme` is called twice per `theme` command

**Severity:** Low (functionally correct, but wasteful / confusing)

**Location:** `src/drawer/terminal.ts`, `subscribeTheme()` + `src/drawer/commands.ts`, `cmdTheme()`

**Reproduction (call trace):**
```
User types: theme nord
  1. dispatch() → cmdTheme() → ctx.setTheme('nord')
       → ThemeManager.setTheme('nord')   ← CALL 1
  2. cmdTheme() also does: bus.emit(THEME_CHANGE, { themeName: 'nord' })
  3. CLITerminal.subscribeTheme() handler fires:
       → this.themeManager.setTheme(evt.themeName)  ← CALL 2
```

The `subscribeTheme` handler is designed to react to external theme changes (e.g., from another panel). But when the CLI itself triggers the theme change, it's the emitter of the bus event — so it redundantly re-applies the same theme it just applied. 

**Fix:** In `subscribeTheme`, skip re-calling `setTheme` if the theme is already active:
```ts
if (evt.themeName && evt.themeName !== this.themeManager.getTheme().name) {
  this.themeManager.setTheme(evt.themeName);
}
```
Or: have `cmdTheme` only call `ctx.setTheme()` (not also emit the bus event) and let the bus event come from `ThemeManager.setTheme()` itself.

---

## Attacks Repelled (63 out of 69 tests passed)

All the following attack classes were correctly handled:

**Path traversal:** `../../../etc/passwd`, `projects/../../../secret.md`, `../about.md`, `projects/../../etc.md` — all rejected by regex (`..` contains `.` not in charset) before manifest lookup.

**Absolute paths:** `/etc/passwd` — rejected by manifest lookup (saves the weak regex). `/etc/passwd` fails regex check because `/` followed by characters is rejected due to charset constraints… wait, actually `/etc/passwd` fails because `passwd` has no `.md` extension, not because of the leading `/`. The manifest lookup is still the real guard.

**Null byte injection:** `index.md\x00.js`, `\x00about.md` — both rejected; the null byte (char code 0) is not in `[a-z0-9/_-]`.

**CRLF injection:** `about.md\r\n` — correctly handled at multiple layers:
  1. terminal.ts `handleData` only echoes chars ≥ 32 into `lineBuffer` (CRLF can't enter)
  2. `dispatch()` calls `input.trim()` which strips surrounding CRLF
  3. `cmdView` calls `args[0]?.trim()` which strips CRLF from path argument

**URL-encoded traversal:** `%2e%2e/etc/passwd`, `about.md%00.js` — rejected (the `%` character not in charset).

**Empty/whitespace input:** empty string, spaces-only — dispatch returns early without crashing.

**Command edge cases:**
- `help foo bar` → shows help (extra args harmless)
- `view` (no path) → usage error, no bus emit
- `theme invalid-name` → error, no setTheme call, no bus emit
- `search` (no query) → usage error
- `CLEAR` (uppercase) → correctly normalized to lowercase via `.toLowerCase()`

**Tab completion:** All edge cases handled cleanly:
- Empty input → all commands listed (multiple)
- No match → `none` type, bell signal
- Single match → `single` type, auto-completed
- Multiple matches → `multiple` type, list shown, input restored
- Cycle wraparound → `(cycleIndex + 1) % numMatches` is correct
- Slash in path (`view projects/`) → works correctly

**History bounds:**
- Up on empty history → `null`, no crash
- Up past beginning → `null` (no wrap)
- Down past end → restores partial input, then `null`
- 51st entry evicts oldest (cap verified)
- Consecutive duplicates not added
- Blank/whitespace commands not added

**Input filtering:** Control characters (0x00–0x1f) are correctly ignored by `charCode >= 32` check in `handleData`. DEL (0x7f) triggers backspace. Escape sequences are swallowed.

**Drawer/m2 interplay:**
- `terminal.ts` does NOT attach any listeners to `#drawer-toggle` or `#divider-bottom` (only a JSDoc comment mentions the element)
- `terminal.ts` uses `ResizeObserver` to refit xterm on drawer expand
- `dispose()` correctly disconnects the `ResizeObserver` and window resize listener
- `FitAddon` is loaded and called

**EventBus subscription leak:** `CLITerminal` correctly stores the unsubscribe function in `this.unsubscribeTheme` and calls it in `dispose()`. Mount → dispose → remount does not accumulate listeners.

---

## Coverage Assessment

The Worker wrote tests for the happy-path cases. The existing test files (`test-path-validation.mjs`, `test-path-edge-cases.mjs`, `test-theme-manager.mjs`, `test-manifest-validation.mjs`) are reasonably thorough but missed:

1. The regex weakness around empty path segments and absolute-path acceptance (test-path-edge-cases.mjs **did** expose this but the Worker left it as a "check" comment rather than a hard failure)
2. The double `setTheme` call on theme command
3. Drawer isolation boundary test (static analysis)
4. History navigation (no tests existed at all)
5. Tab completion edge cases (no tests existed)
6. Input character filtering (no tests existed)
7. Command dispatch case-insensitivity test

The most actionable findings are VUL-1/VUL-2 (same root cause: regex is too permissive). The manifest lookup saves them in production, but the defense-in-depth is broken. Fix the regex.
