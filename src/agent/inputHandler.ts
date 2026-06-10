/**
 * src/agent/inputHandler.ts — Terminal input handler for the agent shell.
 * Handles keypress accumulation, submission, history, and Ctrl+C abort.
 */

import type { AgentTerminal } from './terminal.js';
import type { SSEClient } from './sseClient.js';
import { QUICK_ACTIONS } from './motd.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const HISTORY_MAX = 10;

/** ANSI escape sequences */
const CURSOR_BACK = '\x1b[D';
const CURSOR_FORWARD = '\x1b[C';
const ERASE_CHAR = '\b \b';  // backspace + space + backspace (erase in terminal)

// ─── InputHandler ─────────────────────────────────────────────────────────────

export class InputHandler {
  private readonly terminal: AgentTerminal;
  private readonly sseClient: SSEClient;

  /** Current line buffer being typed. */
  private lineBuffer = '';
  /** Cursor position within lineBuffer (0 = start, lineBuffer.length = end). */
  private cursorPos = 0;
  /** Session command history (user messages). */
  private history: string[] = [];
  /** Index into history during up/down navigation; -1 = current input. */
  private historyIndex = -1;
  /** Saved current input before history navigation. */
  private historyDraft = '';

  private unsubscribeData: (() => void) | null = null;

  constructor(terminal: AgentTerminal, sseClient: SSEClient) {
    this.terminal = terminal;
    this.sseClient = sseClient;
  }

  /** Attach the input handler to the terminal's onData stream. */
  attach(): void {
    this.unsubscribeData = this.terminal.onData((data) => {
      this.handleData(data);
    });
  }

  /** Detach the input handler (cleanup). */
  detach(): void {
    this.unsubscribeData?.();
    this.unsubscribeData = null;
  }

  // ─── Core input handler ────────────────────────────────────────────────────

  private handleData(data: string): void {
    // Ctrl+C
    if (data === '\x03') {
      this.handleCtrlC();
      return;
    }

    // Enter (CR or CRLF)
    if (data === '\r' || data === '\n') {
      this.handleEnter();
      return;
    }

    // Backspace (DEL or BS)
    if (data === '\x7f' || data === '\x08') {
      this.handleBackspace();
      return;
    }

    // Escape sequences (arrows, etc.)
    if (data.startsWith('\x1b[')) {
      this.handleEscape(data);
      return;
    }

    // Printable character(s)
    if (data >= ' ' || data.charCodeAt(0) > 127) {
      this.handlePrintable(data);
      return;
    }

    // Ignore other control chars
  }

  // ─── Key handlers ──────────────────────────────────────────────────────────

  private handleCtrlC(): void {
    if (this.sseClient.isStreaming) {
      // Abort the current streaming request
      this.sseClient.abort();
    } else {
      // Echo ^C and re-show prompt
      this.terminal.write('^C\r\n');
    }
    this.lineBuffer = '';
    this.cursorPos = 0;
    this.historyIndex = -1;
    if (!this.sseClient.isStreaming) {
      this.terminal.write('agent> ');
    }
  }

  private handleEnter(): void {
    // FIX 4: Ignore Enter while streaming — user must use Ctrl+C to abort
    if (this.sseClient.isStreaming) {
      return;
    }

    const line = this.lineBuffer.trim();
    this.terminal.write('\r\n');
    this.lineBuffer = '';
    this.cursorPos = 0;
    this.historyIndex = -1;
    this.historyDraft = '';

    if (!line) {
      // Empty line — re-show prompt
      this.terminal.write('agent> ');
      return;
    }

    // Push to history
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > HISTORY_MAX) {
        this.history = this.history.slice(-HISTORY_MAX);
      }
    }

    // Handle slash commands locally before sending to SSE
    if (line.trim() === '/model') {
      this.sseClient.advanceModel();
      return;
    }

    // Resolve the actual query from quick-action shortcuts
    const resolved = this.resolveInput(line);

    // Submit to the SSE client
    void this.sseClient.sendMessage(resolved);
  }

  private handleBackspace(): void {
    if (this.cursorPos === 0) return;
    // Remove character before cursor
    this.lineBuffer =
      this.lineBuffer.slice(0, this.cursorPos - 1) +
      this.lineBuffer.slice(this.cursorPos);
    this.cursorPos--;

    if (this.cursorPos === this.lineBuffer.length) {
      // Simple case: cursor was at end
      this.terminal.write(ERASE_CHAR);
    } else {
      // Cursor in middle: re-render the tail
      this.terminal.write('\x1b[D');  // move cursor back
      const tail = this.lineBuffer.slice(this.cursorPos);
      this.terminal.write(tail + ' '); // write rest + erase last char
      // Move cursor back to correct position
      const moveBack = tail.length + 1;
      this.terminal.write(`\x1b[${moveBack}D`);
    }
  }

  private handleEscape(seq: string): void {
    switch (seq) {
      case '\x1b[A': // Up arrow
        this.navigateHistory(-1);
        break;
      case '\x1b[B': // Down arrow
        this.navigateHistory(1);
        break;
      case '\x1b[C': // Right arrow
        if (this.cursorPos < this.lineBuffer.length) {
          this.cursorPos++;
          this.terminal.write(CURSOR_FORWARD);
        }
        break;
      case '\x1b[D': // Left arrow
        if (this.cursorPos > 0) {
          this.cursorPos--;
          this.terminal.write(CURSOR_BACK);
        }
        break;
      case '\x1b[H': // Home
      case '\x1b[1~':
        if (this.cursorPos > 0) {
          this.terminal.write(`\x1b[${this.cursorPos}D`);
          this.cursorPos = 0;
        }
        break;
      case '\x1b[F': // End
      case '\x1b[4~':
        if (this.cursorPos < this.lineBuffer.length) {
          const diff = this.lineBuffer.length - this.cursorPos;
          this.terminal.write(`\x1b[${diff}C`);
          this.cursorPos = this.lineBuffer.length;
        }
        break;
      default:
        // Ignore unknown sequences
        break;
    }
  }

  private handlePrintable(chars: string): void {
    if (this.cursorPos === this.lineBuffer.length) {
      // Append at end — simple echo
      this.lineBuffer += chars;
      this.cursorPos += chars.length;
      this.terminal.write(chars);
    } else {
      // Insert at cursor position
      this.lineBuffer =
        this.lineBuffer.slice(0, this.cursorPos) +
        chars +
        this.lineBuffer.slice(this.cursorPos);
      this.cursorPos += chars.length;

      // Re-render from cursor position
      const tail = this.lineBuffer.slice(this.cursorPos);
      this.terminal.write(chars + tail);
      if (tail.length > 0) {
        this.terminal.write(`\x1b[${tail.length}D`);
      }
    }
  }

  // ─── History navigation ────────────────────────────────────────────────────

  private navigateHistory(direction: -1 | 1): void {
    if (this.history.length === 0) return;

    // FIX 6: Down from draft position (historyIndex === -1) is a no-op
    if (this.historyIndex === -1 && direction === 1) return;

    if (this.historyIndex === -1 && direction === -1) {
      // Starting navigation — save current draft
      this.historyDraft = this.lineBuffer;
      this.historyIndex = this.history.length - 1;
    } else {
      const nextIndex = this.historyIndex + direction;
      if (nextIndex < 0) {
        // Went past the beginning — stay at first item
        return;
      }
      if (nextIndex >= this.history.length) {
        // Navigated past end — restore draft
        this.historyIndex = -1;
        this.replaceLineBuffer(this.historyDraft);
        return;
      }
      this.historyIndex = nextIndex;
    }

    const entry = this.history[this.historyIndex] ?? '';
    this.replaceLineBuffer(entry);
  }

  /**
   * Replace the entire current line buffer with new text.
   * Erases the current visual line and re-renders new content.
   */
  private replaceLineBuffer(text: string): void {
    // Move cursor to start of input area, then clear to end
    if (this.cursorPos > 0) {
      this.terminal.write(`\x1b[${this.cursorPos}D`);
    }
    // Overwrite with spaces to erase, then rewrite new text
    const clearLine = ' '.repeat(this.lineBuffer.length);
    this.terminal.write(clearLine);
    if (clearLine.length > 0) {
      this.terminal.write(`\x1b[${clearLine.length}D`);
    }
    this.lineBuffer = text;
    this.cursorPos = text.length;
    this.terminal.write(text);
  }

  // ─── Quick-action resolution ───────────────────────────────────────────────

  /**
   * Translate short numeric shortcuts (1–4) into full queries.
   * Passthrough for everything else.
   */
  private resolveInput(input: string): string {
    const trimmed = input.trim();

    // Numeric shortcut
    for (const action of QUICK_ACTIONS) {
      if (trimmed === action.key) {
        return action.query;
      }
    }

    // agent: URI prefix (from motd OSC 8 links clicked in the terminal)
    if (trimmed.startsWith('agent:query:')) {
      try {
        return decodeURIComponent(trimmed.slice('agent:query:'.length));
      } catch {
        return trimmed;
      }
    }

    return input;
  }
}
