/**
 * src/editor/clickableLinks.ts — Clickable links inside the CodeMirror buffer.
 * Detects http(s) URLs, email addresses, and manifest-relative *.md paths in
 * the raw markdown source and makes them clickable: pointer cursor, underline
 * on hover, and click-to-open (new tab / mail client / FOCUS_FILE).
 */

import { Decoration, EditorView, MatchDecorator, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { bus, EVENT_TYPES } from '../bus.js';
import { getManifestEntry } from '../manifest.js';
import type { FocusFileEvent } from '../types.js';

// http(s) URL (no trailing punctuation) · email address · relative .md path
const LINK_RE =
  /https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?]|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.md\b/g;

/**
 * Return the open-action for a matched token, or null when it isn't a real
 * link (e.g. a .md path that isn't in the manifest).
 */
function resolveLink(text: string): (() => void) | null {
  if (/^https?:\/\//.test(text)) {
    return () => window.open(text, '_blank', 'noopener');
  }
  if (text.includes('@')) {
    return () => { window.location.href = `mailto:${text}`; };
  }
  if (getManifestEntry(text)) {
    return () => bus.emit<FocusFileEvent>(EVENT_TYPES.FOCUS_FILE, {
      path: text,
      triggerSource: 'editor',
    });
  }
  return null;
}

const linkDecorator = new MatchDecorator({
  regexp: LINK_RE,
  decorate: (add, from, to, match) => {
    if (resolveLink(match[0])) {
      add(from, to, Decoration.mark({ class: 'cm-clickable-link' }));
    }
  },
});

export const clickableLinks: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = linkDecorator.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = linkDecorator.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      click(event: MouseEvent, view: EditorView): boolean {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
          return false;
        }
        const target = event.target as HTMLElement;
        if (!target.closest('.cm-clickable-link')) return false;

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;

        // Re-scan the clicked line: a mark decoration can be split across
        // multiple DOM spans by syntax highlighting, so the span's
        // textContent may be only a fragment of the link.
        const line = view.state.doc.lineAt(pos);
        const re = new RegExp(LINK_RE.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(line.text))) {
          const from = line.from + m.index;
          const to = from + m[0].length;
          if (from > pos) break;
          if (pos >= from && pos <= to) {
            const open = resolveLink(m[0]);
            if (open) {
              event.preventDefault();
              open();
              return true;
            }
            return false;
          }
        }
        return false;
      },
    },
  },
);
