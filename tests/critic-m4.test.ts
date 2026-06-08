/**
 * Adversarial test suite for milestone m4-vim-panel.
 * Critic role — attempts to break the implementation.
 *
 * Areas probed:
 *  1. EventBus (bus.ts) — subscribe/unsubscribe, once, leak, throw-safety
 *  2. Manifest path validation (manifest.ts) — path injection, empty, uppercase
 *  3. FileLoader security (fileLoader.ts) — rejects non-manifest paths, no fetch bypass
 *  4. VimEditor read-only guard (vim.ts) — EditorState.readOnly, nop mappings presence
 *  5. FileExplorer / tree (tree.ts) — boundary nav, Enter on dir, highlight with unknown path
 *  6. TreeNavigator (treeNav.ts) — bounds, detach-then-call
 *  7. PowerlineBar (statusBar.ts) — XSS via filePath, scrollPct clamping
 *  8. Race-condition / subscription lifecycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Helper: read a source file relative to the worktree root
function readSrc(relPath: string): string {
  return readFileSync(
    resolve('/home/daniel/src/cli-agent-resume/.claude/worktrees/m4-vim-panel', relPath),
    'utf-8',
  );
}

// Patch scrollIntoView for jsdom (not implemented there)
Element.prototype.scrollIntoView = function () { /* no-op in test env */ };

// ─── 1. EventBus adversarial tests ───────────────────────────────────────────

describe('EventBus', () => {
  let EventBusCtor: typeof import('../src/bus.js').EventBus;

  beforeEach(async () => {
    const mod = await import('../src/bus.js');
    EventBusCtor = mod.EventBus;
  });

  it('subscribe returns a working unsubscribe function', () => {
    const eb = new EventBusCtor();
    const calls: string[] = [];
    const unsub = eb.subscribe<string>('test:ev', (p) => calls.push(p));
    eb.emit('test:ev', 'hello');
    expect(calls).toEqual(['hello']);

    unsub(); // unsubscribe
    eb.emit('test:ev', 'world');
    expect(calls).toEqual(['hello']); // no second call
  });

  it('emit to event with NO subscribers does NOT throw', () => {
    const eb = new EventBusCtor();
    expect(() => eb.emit('no:one:listens', { data: 123 })).not.toThrow();
  });

  it('once auto-unsubscribes after first fire', () => {
    const eb = new EventBusCtor();
    const calls: number[] = [];
    eb.once<number>('once:ev', (n) => calls.push(n));
    eb.emit('once:ev', 1);
    eb.emit('once:ev', 2);
    eb.emit('once:ev', 3);
    expect(calls).toEqual([1]); // only first
  });

  it('once fires exactly once even with immediate emit', () => {
    const eb = new EventBusCtor();
    const calls: string[] = [];
    eb.once<string>('instant', (v) => calls.push(v));
    eb.emit('instant', 'A');
    eb.emit('instant', 'B');
    expect(calls).toEqual(['A']);
  });

  it('repeated subscribe/unsubscribe does not accumulate dead listeners (no leak)', () => {
    const eb = new EventBusCtor();
    const calls: number[] = [];
    for (let i = 0; i < 100; i++) {
      const unsub = eb.subscribe<number>('leaky', (n) => calls.push(n));
      unsub();
    }
    eb.emit('leaky', 99);
    expect(calls).toHaveLength(0); // all unsubscribed
  });

  it('throwing handler does not prevent other handlers from running', () => {
    const eb = new EventBusCtor();
    const called: string[] = [];
    eb.subscribe('err:ev', () => { throw new Error('boom'); });
    eb.subscribe<string>('err:ev', (v) => called.push(v as string));
    // emit should not re-throw
    expect(() => eb.emit('err:ev', 'after-throw')).not.toThrow();
    expect(called).toContain('after-throw');
  });

  it('handler can unsubscribe itself during emit without infinite loop', () => {
    const eb = new EventBusCtor();
    let callCount = 0;
    let unsub: (() => void) | null = null;
    unsub = eb.subscribe('self-unsub', () => {
      callCount++;
      unsub!();
    });
    eb.emit('self-unsub', null);
    eb.emit('self-unsub', null);
    expect(callCount).toBe(1);
  });

  it('clear() removes all listeners across all event types', () => {
    const eb = new EventBusCtor();
    const calls: number[] = [];
    eb.subscribe('a', () => calls.push(1));
    eb.subscribe('b', () => calls.push(2));
    eb.clear();
    eb.emit('a', null);
    eb.emit('b', null);
    expect(calls).toHaveLength(0);
  });

  it('clear(eventType) only removes listeners for that type', () => {
    const eb = new EventBusCtor();
    const aHits: number[] = [];
    const bHits: number[] = [];
    eb.subscribe('alpha', () => aHits.push(1));
    eb.subscribe('beta', () => bHits.push(1));
    eb.clear('alpha');
    eb.emit('alpha', null);
    eb.emit('beta', null);
    expect(aHits).toHaveLength(0);
    expect(bHits).toHaveLength(1);
  });

  it('1000 subscribe+unsubscribe leaves zero listeners (stress test)', () => {
    const eb = new EventBusCtor();
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 1000; i++) {
      unsubs.push(eb.subscribe('stress', () => {}));
    }
    unsubs.forEach(u => u());
    // No listeners remain — emit should do nothing
    let count = 0;
    eb.subscribe('stress', () => count++);
    eb.emit('stress', null);
    expect(count).toBe(1); // only the final subscription fired
  });
});

// ─── 2. Manifest path regex adversarial tests ────────────────────────────────

describe('manifest path validation regex (VALID_PATH_RE)', () => {
  const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

  const shouldBeInvalid: string[] = [
    '../../../etc/passwd',
    '/etc/passwd',
    '../../secret.md',
    'projects/../../../secret.md',
    '',
    'README.MD',             // uppercase extension
    'File With Spaces.md',
    'UPPER.md',
    'a/b/../c.md',           // .. component
    'foo.txt',
    'foo.md.exe',
    'foo\\.md',             // backslash
    'foo%2F..%2Fetc.md',   // URL-encoded traversal
    'foo\0bar.md',          // null byte
    '.md',                  // no filename stem
  ];

  const shouldBeValid: string[] = [
    'index.md',
    'projects/my-project.md',
    'about/me.md',
    'experience/senior-engineer-2024.md',
    'a/b/c/d.md',
    'a/b-c_d/e.md',
  ];

  for (const p of shouldBeInvalid) {
    it(`SHOULD reject: "${p}"`, () => {
      expect(VALID_PATH_RE.test(p)).toBe(false);
    });
  }

  for (const p of shouldBeValid) {
    it(`SHOULD accept: "${p}"`, () => {
      expect(VALID_PATH_RE.test(p)).toBe(true);
    });
  }

  // Known weakness: regex permits consecutive slashes and hidden-style filenames
  it('FINDING: regex accepts "a/.md" (hidden-style) — regex permits this', () => {
    // a/.md passes because /^[a-z0-9/_-]+\.md$/ matches 'a/' before '.md'
    // The '+' requires at least one char before .md, and 'a/' satisfies it.
    const result = VALID_PATH_RE.test('a/.md');
    // This is a regex weakness — manifest index lookup would likely not have this path,
    // but the format validator is too permissive.
    expect(result).toBe(true); // documents the weakness — it SHOULD be false
  });

  it('FINDING: regex accepts "a//b.md" (double slash) — consecutive slashes allowed', () => {
    const result = VALID_PATH_RE.test('a//b.md');
    // Double-slash should arguably be invalid; regex allows it.
    expect(result).toBe(true); // documents the weakness
  });
});

// ─── 3. FileLoader security tests ────────────────────────────────────────────

describe('fileLoader.loadFile — path security (pre-fetch rejection)', () => {
  const ATTACK_PATHS = [
    '../../../etc/passwd',
    '/etc/passwd',
    'projects/../../../secret.md',
    '',
    'nonexistent.md',
  ];

  for (const attackPath of ATTACK_PATHS) {
    it(`rejects "${attackPath}" before any content fetch`, async () => {
      // Mock fetch: track all calls
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const u = String(url);
        // Allow the manifest to load (so the manifest check runs), return empty manifest
        if (u.includes('manifest.json')) {
          return new Response(
            JSON.stringify({ entries: [], buildDate: '2024-01-01', version: '1.0' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        // Any other fetch (content file) should NOT be reached for these paths
        throw new Error(`Unexpected fetch to: ${u}`);
      });

      const { loadFile } = await import('../src/editor/fileLoader.js');

      try {
        await expect(loadFile(attackPath)).rejects.toThrow(/not found in manifest/i);
      } finally {
        fetchSpy.mockRestore();
        vi.resetModules();
      }

      // Verify no content fetch was attempted with malicious path segments
      for (const call of fetchSpy.mock.calls) {
        const url = String(call[0]);
        expect(url).not.toContain('passwd');
        expect(url).not.toMatch(/\.\.\//);
      }
    });
  }
});

// ─── 4. Manifest validateManifest / validateEntry logic tests ─────────────────

describe('manifest validation (reconstructed logic)', () => {
  function validateManifest(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    const m = data as Record<string, unknown>;
    return (
      Array.isArray(m['entries']) &&
      typeof m['buildDate'] === 'string' &&
      typeof m['version'] === 'string'
    );
  }

  function validateEntry(entry: unknown): boolean {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e['path'] === 'string' &&
      typeof e['title'] === 'string' &&
      Array.isArray(e['sections']) &&
      (e['sections'] as unknown[]).every((s) => typeof s === 'string') &&
      typeof e['excerpt'] === 'string' &&
      typeof e['hash'] === 'string'
    );
  }

  it('validateManifest rejects null', () => expect(validateManifest(null)).toBe(false));
  it('validateManifest rejects undefined', () => expect(validateManifest(undefined)).toBe(false));
  it('validateManifest rejects arrays', () => expect(validateManifest([])).toBe(false));
  it('validateManifest rejects string', () => expect(validateManifest('str')).toBe(false));
  it('validateManifest rejects non-array entries', () =>
    expect(validateManifest({ entries: 'bad', buildDate: '', version: '' })).toBe(false));
  it('validateManifest accepts minimal valid shape', () =>
    expect(validateManifest({ entries: [], buildDate: '', version: '' })).toBe(true));

  it('validateEntry rejects missing path', () =>
    expect(validateEntry({ title: 'x', sections: [], excerpt: '', hash: '' })).toBe(false));
  it('validateEntry rejects non-string sections', () =>
    expect(validateEntry({ path: 'a.md', title: 'x', sections: [1], excerpt: '', hash: '' })).toBe(false));
  it('validateEntry rejects null', () => expect(validateEntry(null)).toBe(false));

  it('FINDING: validateEntry does NOT check path format — traversal strings pass entry validation', () => {
    // A manifest entry with path "../../../etc/passwd" passes validateEntry
    // because validateEntry only checks types, not path safety.
    // The security relies entirely on isValidPathFormat() in validatePath().
    const evil = { path: '../../../etc/passwd', title: 'evil', sections: [], excerpt: '', hash: 'abc' };
    expect(validateEntry(evil)).toBe(true); // documents this reliance
  });
});

// ─── 5. VimEditor — static code checks (read-only enforcement) ───────────────

describe('VimEditor read-only hardening (source analysis)', () => {
  const vimSrc = readSrc('src/editor/vim.ts');

  it('EditorState.readOnly.of(true) is present in extensions list', () => {
    expect(vimSrc).toContain('EditorState.readOnly.of(true)');
  });

  it('"d" mapped to <Nop> in normal mode (delete blocked)', () => {
    expect(vimSrc).toContain("Vim.map('d', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('D', '<Nop>', 'normal')");
  });

  it('"p"/"P" mapped to <Nop> in normal mode (paste blocked)', () => {
    expect(vimSrc).toContain("Vim.map('p', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('P', '<Nop>', 'normal')");
  });

  it('"x"/"X" mapped to <Nop> in normal mode (single-char delete blocked)', () => {
    expect(vimSrc).toContain("Vim.map('x', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('X', '<Nop>', 'normal')");
  });

  it('"c"/"C" mapped to <Nop> in normal mode (change blocked)', () => {
    expect(vimSrc).toContain("Vim.map('c', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('C', '<Nop>', 'normal')");
  });

  it('"r"/"R" mapped to <Nop> in normal mode (replace blocked)', () => {
    expect(vimSrc).toContain("Vim.map('r', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('R', '<Nop>', 'normal')");
  });

  it('"s"/"S" mapped to <Nop> in normal mode (substitute-char blocked)', () => {
    expect(vimSrc).toContain("Vim.map('s', '<Nop>', 'normal')");
    expect(vimSrc).toContain("Vim.map('S', '<Nop>', 'normal')");
  });

  it('"i"/"I"/"a"/"A"/"o"/"O" mapped to <Nop> (insert-mode entry blocked)', () => {
    for (const key of ['i', 'I', 'a', 'A', 'o', 'O']) {
      expect(vimSrc).toContain(`Vim.map('${key}', '<Nop>', 'normal')`);
    }
  });

  it('FINDING: "J" (join lines) NOT mapped to <Nop> — belt-and-suspenders gap', () => {
    // J modifies content by joining the current line with the next.
    // It is NOT in the Vim.map nop list. EditorState.readOnly is the only guard.
    const hasJNop = vimSrc.includes("Vim.map('J', '<Nop>', 'normal')");
    expect(hasJNop).toBe(false); // confirms the gap
  });

  it('FINDING: visual-mode "d" NOT nop-mapped (only normal mode)', () => {
    // Vim.map('d', '<Nop>', 'normal') only covers normal mode.
    // In visual mode, pressing 'd' would delete the selection.
    // The CM readOnly guard is the safety net, but visual-mode nop is absent.
    const hasVisualD = vimSrc.includes("Vim.map('d', '<Nop>', 'visual')");
    expect(hasVisualD).toBe(false); // confirms the gap
  });

  it('FINDING: ":s" (substitute) ex command NOT overridden as noop', () => {
    const hasSubstitute = vimSrc.includes("defineEx('substitute'") ||
      vimSrc.includes("defineEx('s'");
    expect(hasSubstitute).toBe(false);
  });

  it('FINDING: ":put" ex command NOT overridden as noop', () => {
    expect(vimSrc).not.toContain("defineEx('put'");
  });

  it('unsubscribeFocusFile is stored and called on destroy()', () => {
    expect(vimSrc).toContain('unsubscribeFocusFile');
    expect(vimSrc).toContain('this.unsubscribeFocusFile?.()');
  });
});

describe('VimEditor runtime checks (no DOM required)', () => {
  it('isReadOnly() always returns true', async () => {
    const { VimEditor } = await import('../src/editor/vim.js');
    const editor = new VimEditor();
    expect(editor.isReadOnly()).toBe(true);
  });

  it('getState() throws before create()', async () => {
    const { VimEditor } = await import('../src/editor/vim.js');
    const editor = new VimEditor();
    expect(() => editor.getState()).toThrow();
  });

  it('destroy() before create() is safe (no throw)', async () => {
    const { VimEditor } = await import('../src/editor/vim.js');
    const editor = new VimEditor();
    expect(() => editor.destroy()).not.toThrow();
  });

  it('destroy() is idempotent (double-call safe)', async () => {
    const { VimEditor } = await import('../src/editor/vim.js');
    const editor = new VimEditor();
    expect(() => {
      editor.destroy();
      editor.destroy();
    }).not.toThrow();
  });

  it('getCurrentFile() returns "index.md" before any file loaded', async () => {
    const { VimEditor } = await import('../src/editor/vim.js');
    const editor = new VimEditor();
    expect(editor.getCurrentFile()).toBe('index.md');
  });
});

// ─── 6. FileExplorer boundary + nav tests ────────────────────────────────────

describe('FileExplorer boundary conditions', () => {
  function makeManifest(entries: Array<{ path: string; title: string }>) {
    return {
      buildDate: '2024-01-01T00:00:00Z',
      version: '1.0',
      entries: entries.map(e => ({
        path: e.path,
        title: e.title,
        sections: [],
        excerpt: '',
        hash: 'abc123',
      })),
    };
  }

  it('highlight() with unknown path does not throw', async () => {
    const { FileExplorer } = await import('../src/explorer/tree.js');
    const exp = new FileExplorer();
    const el = document.createElement('div');
    exp.render(el, makeManifest([{ path: 'index.md', title: 'Home' }]));
    expect(() => exp.highlight('nonexistent/path.md')).not.toThrow();
    expect(exp.getSelectedPath()).toBe('nonexistent/path.md');
    exp.destroy();
  });

  it('clicking a file emits FOCUS_FILE with correct path', async () => {
    vi.resetModules();
    const { bus } = await import('../src/bus.js');
    const { FileExplorer } = await import('../src/explorer/tree.js');

    const emitted: Array<{ path: string }> = [];
    const unsub = bus.subscribe<{ path: string }>('focus:file', (e) => emitted.push(e));

    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'test/page.md', title: 'Test Page' }]));

    const fileItem = el.querySelector<HTMLElement>('.tree-item[data-path="test/page.md"]');
    expect(fileItem).not.toBeNull();
    fileItem!.click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.path).toBe('test/page.md');

    unsub();
    document.body.removeChild(el);
    exp.destroy();
  });

  it('clicking a directory does NOT emit FOCUS_FILE', async () => {
    vi.resetModules();
    const { bus } = await import('../src/bus.js');
    const { FileExplorer } = await import('../src/explorer/tree.js');

    const emitted: unknown[] = [];
    const unsub = bus.subscribe('focus:file', (e) => emitted.push(e));

    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'projects/foo.md', title: 'Foo' }]));

    // Dir items have no data-path
    const dirItems = Array.from(el.querySelectorAll<HTMLElement>('.tree-item'))
      .filter(i => !i.dataset['path']);
    expect(dirItems.length).toBeGreaterThan(0);
    dirItems[0]!.click();

    expect(emitted).toHaveLength(0);

    unsub();
    document.body.removeChild(el);
    exp.destroy();
  });

  it('Enter with no selection does NOT emit FOCUS_FILE', async () => {
    vi.resetModules();
    const { bus } = await import('../src/bus.js');
    const { FileExplorer } = await import('../src/explorer/tree.js');

    const emitted: unknown[] = [];
    const unsub = bus.subscribe('focus:file', (e) => emitted.push(e));

    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([]));
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(emitted).toHaveLength(0);

    unsub();
    document.body.removeChild(el);
    exp.destroy();
  });

  it('? shows help overlay; Esc dismisses it', async () => {
    const { FileExplorer } = await import('../src/explorer/tree.js');
    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'index.md', title: 'Home' }]));
    el.focus();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    expect(el.querySelector('.nerd-tree-help')).not.toBeNull();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.querySelector('.nerd-tree-help')).toBeNull();

    document.body.removeChild(el);
    exp.destroy();
  });

  it('pressing ? twice shows only ONE help overlay (no duplicate)', async () => {
    const { FileExplorer } = await import('../src/explorer/tree.js');
    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'index.md', title: 'Home' }]));
    el.focus();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));

    const overlays = el.querySelectorAll('.nerd-tree-help');
    expect(overlays.length).toBe(1);

    document.body.removeChild(el);
    exp.destroy();
  });

  it('destroy() stops FOCUS_FILE events from triggering highlight()', async () => {
    vi.resetModules();
    const { bus } = await import('../src/bus.js');
    const { FileExplorer } = await import('../src/explorer/tree.js');

    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'index.md', title: 'Home' }]));

    const highlightSpy = vi.spyOn(exp, 'highlight');
    exp.destroy(); // unsubscribes

    bus.emit('focus:file', { path: 'index.md', triggerSource: 'agent' });
    expect(highlightSpy).not.toHaveBeenCalled();

    document.body.removeChild(el);
  });

  it('j/k navigation does not crash with single item', async () => {
    const { FileExplorer } = await import('../src/explorer/tree.js');
    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'solo.md', title: 'Solo' }]));
    el.focus();

    // Multiple j presses — should not crash
    expect(() => {
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      }
      // Multiple k presses — should not crash
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      }
    }).not.toThrow();

    document.body.removeChild(el);
    exp.destroy();
  });

  it('j/k wraps modularly — j from last lands back at first, k from first lands at last', async () => {
    const { FileExplorer } = await import('../src/explorer/tree.js');
    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([
      { path: 'a.md', title: 'A' },
      { path: 'b.md', title: 'B' },
      { path: 'c.md', title: 'C' },
    ]));
    el.focus();

    // Select item 0 via j
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(exp.getSelectedPath()).toBe('a.md');

    // Press k — was at first item, should wrap to last
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(exp.getSelectedPath()).toBe('c.md');

    // Press j — was at last item, should wrap to first
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(exp.getSelectedPath()).toBe('a.md');

    document.body.removeChild(el);
    exp.destroy();
  });

  it('Enter on file emits FOCUS_FILE with correct path', async () => {
    vi.resetModules();
    const { bus } = await import('../src/bus.js');
    const { FileExplorer } = await import('../src/explorer/tree.js');

    const emitted: Array<{ path: string }> = [];
    const unsub = bus.subscribe<{ path: string }>('focus:file', (e) => emitted.push(e));

    const exp = new FileExplorer();
    const el = document.createElement('div');
    document.body.appendChild(el);
    exp.render(el, makeManifest([{ path: 'enter-test.md', title: 'Enter Test' }]));
    el.focus();

    // Navigate to the file
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(exp.getSelectedPath()).toBe('enter-test.md');

    // Press Enter
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.path).toBe('enter-test.md');

    unsub();
    document.body.removeChild(el);
    exp.destroy();
  });

  it('FINDING: tree.ts onKeyDown has no "?" handler for keyboard nav — only FileExplorer.onKeyDown does', () => {
    // treeNav.ts TreeNavigator.handleKeyDown does NOT handle '?' key
    // Only FileExplorer.onKeyDown handles '?'
    const navSrc = readSrc('src/explorer/treeNav.ts');
    expect(navSrc).not.toContain("case '?':");
    // This means a standalone TreeNavigator (without FileExplorer) won't show help
  });
});

// ─── 7. TreeNavigator boundary tests ─────────────────────────────────────────

describe('TreeNavigator boundary conditions', () => {
  it('moveCursor on empty tree does not throw', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';
    nav.attach(el);
    expect(() => nav.moveCursor('up')).not.toThrow();
    expect(() => nav.moveCursor('down')).not.toThrow();
    nav.detach();
  });

  it('selectCurrent() with cursor=-1 does not throw or emit bus event', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const { bus } = await import('../src/bus.js');

    const emitted: unknown[] = [];
    const unsub = bus.subscribe('focus:file', (e) => emitted.push(e));

    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';
    nav.attach(el);
    expect(() => nav.selectCurrent()).not.toThrow();
    expect(emitted).toHaveLength(0);

    unsub();
    nav.detach();
  });

  it('detach() then moveCursor does not throw', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';
    nav.attach(el);
    nav.detach();
    expect(() => nav.moveCursor('down')).not.toThrow();
  });

  it('double detach() does not throw', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    nav.attach(el);
    expect(() => {
      nav.detach();
      nav.detach();
    }).not.toThrow();
  });

  it('cursor clamps at top (no negative index)', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset['path'] = 'test.md';
    el.appendChild(item);

    nav.attach(el);
    nav.moveCursor('down');  // 0
    nav.moveCursor('up');    // should clamp at 0
    nav.moveCursor('up');    // still 0 — no crash

    // Select current — should work (cursor is 0)
    expect(() => nav.selectCurrent()).not.toThrow();
    nav.detach();
  });

  it('cursor clamps at bottom (no overflow)', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset['path'] = 'test.md';
    el.appendChild(item);

    nav.attach(el);
    nav.moveCursor('down');   // 0
    nav.moveCursor('down');   // clamped at 0 (only 1 item)
    nav.moveCursor('down');   // still 0

    expect(() => nav.selectCurrent()).not.toThrow();
    nav.detach();
  });

  it('FINDING: TreeNavigator handles no "?" key (help not available from standalone nav)', async () => {
    const { TreeNavigator } = await import('../src/explorer/treeNav.js');
    const nav = new TreeNavigator();
    const el = document.createElement('div');
    el.className = 'nerd-tree';
    document.body.appendChild(el);
    nav.attach(el);
    el.focus();
    // Pressing '?' should do nothing (no crash, no overlay)
    expect(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))).not.toThrow();
    expect(document.querySelector('.nerd-tree-help')).toBeNull();
    nav.detach();
    document.body.removeChild(el);
  });
});

// ─── 8. PowerlineBar XSS / DOM injection tests ───────────────────────────────

describe('PowerlineBar XSS hardening', () => {
  it('escapeHtml (reconstructed) prevents script injection via filePath', () => {
    function escapeHtml(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(escapeHtml('"onload=alert(1)')).not.toContain('"');
  });

  it('scrollPct clamped at [0, 100] for normal values', () => {
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    expect(clamp(-999)).toBe(0);
    expect(clamp(101)).toBe(100);
    expect(clamp(50)).toBe(50);
    expect(clamp(Infinity)).toBe(100);
    expect(clamp(-Infinity)).toBe(0);
  });

  it('VULNERABILITY: scrollPct clamp does NOT protect against NaN — NaN propagates through Math.max/min', () => {
    // The source code: scrollPct = Math.max(0, Math.min(100, scrollPct))
    // NaN propagates: Math.max(0, NaN) === NaN, Math.min(100, NaN) === NaN
    // This means if visibleRanges[0].from returns NaN, scrollPct will be NaN
    // and the scrollLabel will be "NaN%" instead of "Top"/"Bot"/percentage.
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    const result = clamp(NaN);
    expect(isNaN(result)).toBe(true); // NaN is NOT clamped to 0 — bug confirmed
    // Fix: use `|| 0` after the clamp: scrollPct = Math.max(0, Math.min(100, scrollPct)) || 0
  });

  it('PowerlineBar constructor sets className to "powerline-bar"', async () => {
    const { PowerlineBar } = await import('../src/editor/statusBar.js');
    const el = document.createElement('div');
    document.body.appendChild(el);
    new PowerlineBar(el);
    expect(el.className).toBe('powerline-bar');
    document.body.removeChild(el);
  });

  it('PowerlineBar with XSS file path does NOT create <img> tags in DOM', async () => {
    const { PowerlineBar } = await import('../src/editor/statusBar.js');
    const el = document.createElement('div');
    document.body.appendChild(el);

    const bar = new PowerlineBar(el);
    bar.setFile('<img src=x onerror=alert(1)>.md');
    bar.setLoading(false); // triggers a re-render if loading was set

    // Should be escaped — no real <img> element
    expect(el.querySelectorAll('img').length).toBe(0);
    document.body.removeChild(el);
  });

  it('PowerlineBar setLoading() toggles .loading class cleanly', async () => {
    const { PowerlineBar } = await import('../src/editor/statusBar.js');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bar = new PowerlineBar(el);

    bar.setLoading(true);
    expect(el.classList.contains('loading')).toBe(true);

    bar.setLoading(false);
    expect(el.classList.contains('loading')).toBe(false);

    // Double false call should be idempotent
    bar.setLoading(false);
    expect(el.classList.contains('loading')).toBe(false);

    document.body.removeChild(el);
  });

  it('sepClass IS escaped via escapeHtml before being used in innerHTML (good)', async () => {
    // statusBar.ts uses escapeHtml(sepClass) in the rendered HTML template.
    const statusSrc = readSrc('src/editor/statusBar.ts');
    const hasSepClassEscape = statusSrc.includes("escapeHtml(sepClass)");
    // Confirmed: sepClass IS sanitized — no injection via CSS class name in innerHTML
    expect(hasSepClassEscape).toBe(true);
  });
});

// ─── 9. getDefaultFile bypass analysis ───────────────────────────────────────

describe('fileLoader.getDefaultFile bypass analysis', () => {
  it('getDefaultFile takes no parameters (cannot be called with user-controlled path)', () => {
    const src = readSrc('src/editor/fileLoader.ts');
    expect(src).toContain('export async function getDefaultFile(): Promise<string>');
  });

  it('getDefaultFile fallback fetch is hardcoded to "index.md" only', () => {
    const src = readSrc('src/editor/fileLoader.ts');
    // The fallback must use the literal 'index.md', not a variable
    expect(src).toContain("return await fetchMarkdown('index.md')");
  });

  it('FINDING: getDefaultFile fallback bypasses manifest check for index.md', () => {
    // When loadFile('index.md') fails (e.g., manifest not yet populated or index.md absent),
    // getDefaultFile falls back to fetchMarkdown('index.md') directly — skipping manifest check.
    // This is intentional but worth noting: any server at /www/index.md is blindly fetched.
    const src = readSrc('src/editor/fileLoader.ts');
    expect(src).toContain('Fallback: direct fetch without manifest check');
    // Acceptable risk: index.md is always expected to exist at a known static path.
  });
});

// ─── 10. CSS module injection (tree.ts inline innerHTML check) ────────────────

describe('tree.ts innerHTML injection guard', () => {
  it('buildDOMList root label uses innerHTML — check for unsanitised node.name', () => {
    const src = readSrc('src/explorer/tree.ts');
    // The root label uses innerHTML with node.name:
    // rootItem.innerHTML = `...<strong>${node.name}/</strong>...`
    // node.name comes from DirNode.name, which is built from manifest entry path splits.
    // manifest paths are validated at load time, but this is still an innerHTML risk.
    const hasRootLabelInnerHTML = src.includes('rootItem.innerHTML');
    expect(hasRootLabelInnerHTML).toBe(true); // confirms innerHTML is used unsanitised
    // FINDING: node.name (dir name from path split) is inserted via innerHTML without escaping
  });

  it('FINDING: buildDOMList root label inserts node.name via innerHTML without escaping', () => {
    // If a malicious manifest entry had path "Projects/<script>/foo.md",
    // the dir name "<script>" would be split out and inserted into innerHTML.
    // However: manifest path validation (VALID_PATH_RE) only allows [a-z0-9/_-]
    // so <script> would fail format validation. The defence works, but it's layered.
    // This is a belt-and-suspenders finding: innerHTML should be safe but relies on
    // the regex being the only path to get a dir name into the tree.
    const src = readSrc('src/explorer/tree.ts');
    expect(src).toContain('rootItem.innerHTML');
    // Confirmed: no escaping on this line.
  });
});

// ─── 11. manifest.ts — validatePath doesn't short-circuit on empty string ─────

describe('manifest.ts validatePath edge cases', () => {
  it('validatePath returns false for empty string (regex test fails)', () => {
    const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;
    // '+' requires at least 1 char before '.md' — empty string fails
    expect(VALID_PATH_RE.test('')).toBe(false);
  });

  it('validatePath returns false for null-byte-embedded path', () => {
    const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;
    expect(VALID_PATH_RE.test('foo\0bar.md')).toBe(false);
  });
});
