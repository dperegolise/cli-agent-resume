/**
 * src/agent/sseClient.ts — SSE streaming client for the /agent endpoint.
 * POST /agent with messages + session_id; parses text/event-stream response.
 *
 * Responsibilities:
 *  - Maintain a rolling 20-message conversation history
 *  - Stream tokens to the terminal as they arrive
 *  - Handle focus_item / search_results / done / error SSE events
 *  - Enforce client-side ban via localStorage
 *  - Abort streaming on Ctrl+C
 */

import { bus, EVENT_TYPES } from '../bus.js';
import { validatePath, getAllPaths } from '../manifest.js';
import { markdownToAnsi, wrapAnsi } from './mdAnsi.js';
import type { AgentTerminal } from './terminal.js';
import type {
  ChatMessage,
  SSEEvent,
  SSETokenEvent,
  SSEFocusItemEvent,
  SSESearchResultsEvent,
  SSEDoneEvent,
  SSEErrorEvent,
} from '../types.js';
import { createLogger } from '../utils/logging.js';

const log = createLogger('sseClient');

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_ENDPOINT = '/agent';
const HISTORY_MAX = 20;
const BAN_STORAGE_KEY = 'agent_banned_until';

// ANSI escape codes
const ANSI_RED    = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_DIM    = '\x1b[2m';
const ANSI_ITALIC = '\x1b[3m';
const ANSI_RESET  = '\x1b[0m';
const ANSI_BOLD   = '\x1b[1m';
const ANSI_CYAN   = '\x1b[96m'; // bright-cyan — user prompt color

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ─── SSEClient ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 3000;

export class SSEClient {
  private readonly terminal: AgentTerminal;
  private readonly sessionId: string;
  private history: ChatMessage[] = [];
  private currentAbortController: AbortController | null = null;
  private streaming = false;
  private lastSentAt = 0;
  // Word-wrap state: tracks cursor column and buffers the current word so we
  // can measure it before committing to the line (tokens arrive one word at a
  // time from the backend, so we can't peek ahead within a single token).
  private wrapCol = 0;
  private wordBuf = '';
  // Accumulated raw text of the current response (rendered as markdown on done).
  private streamBuf = '';
  // Interval timer and frame counter for the spinner animation.
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  // Set to true once search_results have been written, so we insert a blank
  // line before the response text begins.
  private hadSearchResults = false;
  // How many responses have been shown (for the first-response free-model note).
  private responseCount = 0;
  // How many OpenRouter models to skip (advanced via /model command).
  private modelSkip = 0;

  constructor(terminal: AgentTerminal) {
    this.terminal = terminal;
    this.sessionId = SSEClient.generateSessionId();
  }

  /** Generate a UUID v4 session identifier. */
  private static generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Advance to the next model in the cascade and inform the user.
   * Wraps around when all models are exhausted.
   */
  advanceModel(): void {
    this.modelSkip++;
    this.terminal.writeln(
      ANSI_DIM + `Switched to next model (skip=${this.modelSkip}). Send a message to try it.` + ANSI_RESET,
    );
    this.terminal.write('\r\nagent> ');
  }

  /** Abort the current streaming request (Ctrl+C). */
  abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.streaming = false;
      this.stopSpinner();
      this.terminal.write('\r\n' + ANSI_YELLOW + '^C' + ANSI_RESET + '\r\n');
    }
  }

  /** True while an SSE response is being streamed. */
  get isStreaming(): boolean {
    return this.streaming;
  }

  /**
   * Send a user message to the /agent endpoint and stream the response.
   * Adds the message to conversation history before sending.
   */
  async sendMessage(msg: string): Promise<void> {
    // ── Hard debounce: reject if last send was < 3 s ago ──────────────────
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (this.lastSentAt > 0 && elapsed < DEBOUNCE_MS) {
      const remaining = ((DEBOUNCE_MS - elapsed) / 1000).toFixed(1);
      this.terminal.writeln(
        ANSI_YELLOW + `Please wait ${remaining}s before sending another message.` + ANSI_RESET,
      );
      this.terminal.write('\r\nagent> ');
      return;
    }
    this.lastSentAt = now;

    // ── Client-side ban check ──────────────────────────────────────────────
    const banUntilStr = localStorage.getItem(BAN_STORAGE_KEY);
    if (banUntilStr) {
      const banUntil = new Date(banUntilStr);
      if (banUntil > new Date()) {
        const timeStr = banUntil.toLocaleTimeString();
        this.terminal.writeln(
          ANSI_RED +
            `Rate limit exceeded. Try again after ${timeStr}.` +
            ANSI_RESET,
        );
        this.terminal.write('\r\nagent> ');
        return;
      } else {
        localStorage.removeItem(BAN_STORAGE_KEY);
      }
    }

    // ── Echo user prompt ───────────────────────────────────────────────────
    this.terminal.writeln(`\r\n${ANSI_DIM}you>${ANSI_RESET} ${ANSI_CYAN}${msg}${ANSI_RESET}`);

    // ── Append user turn to history ────────────────────────────────────────
    this.history.push({ role: 'user', content: msg });
    if (this.history.length > HISTORY_MAX) {
      this.history = this.history.slice(-HISTORY_MAX);
    }

    // ── Setup abort controller ─────────────────────────────────────────────
    this.currentAbortController = new AbortController();
    this.streaming = true;

    // ── POST request (FIX 5: 30-second timeout) ────────────────────────────
    let response: Response;
    const timeoutId = setTimeout(() => this.currentAbortController?.abort(), 30_000);
    try {
      response = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Model-Skip': String(this.modelSkip),
        },
        body: JSON.stringify({
          messages: this.history,
          session_id: this.sessionId,
        }),
        signal: this.currentAbortController.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      this.streaming = false;
      this.currentAbortController = null;

      if (err instanceof Error && err.name === 'AbortError') {
        // Silently handled in abort() or by timeout
        return;
      }

      // Backend unreachable
      this.terminal.writeln(
        ANSI_RED +
          '⚠ Agent backend is unreachable. Please try again later.' +
          ANSI_RESET,
      );
      this.terminal.write('\r\nagent> ');
      log.error('fetch failed', err);
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    // ── Check ban header ───────────────────────────────────────────────────
    const bannedUntilHeader = response.headers.get('X-Client-Banned-Until');
    if (bannedUntilHeader) {
      localStorage.setItem(BAN_STORAGE_KEY, bannedUntilHeader);
      log.warn('Client banned until', bannedUntilHeader);
    }

    // FIX 3: Explicit 429 handler — must be checked BEFORE the generic !response.ok check
    // to avoid falling through to streamSSE() which throws "Response body is null"
    if (response.status === 429) {
      const banUntil = response.headers.get('X-Client-Banned-Until');
      if (banUntil) {
        localStorage.setItem(BAN_STORAGE_KEY, banUntil);
      }
      const banUntilStr = localStorage.getItem(BAN_STORAGE_KEY);
      const timeStr = banUntilStr
        ? new Date(parseInt(banUntilStr, 10)).toLocaleTimeString()
        : 'later';
      this.terminal.writeln(ANSI_RED + `Rate limit exceeded. Try again after ${timeStr}.` + ANSI_RESET);
      this.terminal.write('\r\nagent> ');
      this.streaming = false;
      this.currentAbortController = null;
      return;
    }

    if (!response.ok) {
      this.streaming = false;
      this.currentAbortController = null;
      this.terminal.writeln(
        ANSI_RED + `Error: HTTP ${response.status} ${response.statusText}` + ANSI_RESET,
      );
      this.terminal.write('\r\nagent> ');
      return;
    }

    // ── Stream SSE events ──────────────────────────────────────────────────
    this.terminal.write('\r\n');
    this.wrapCol = 0;
    this.wordBuf = '';
    this.streamBuf = '';
    this.spinnerFrame = 0;
    this.hadSearchResults = false;
    this.startSpinner();
    let assistantContent = '';
    try {
      assistantContent = await this.streamSSE(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Already handled in abort()
      } else {
        this.terminal.writeln(
          ANSI_RED + '⚠ Stream error: ' + String(err) + ANSI_RESET,
        );
        this.terminal.write('\r\nagent> ');
        log.error('stream error', err);
      }
    } finally {
      this.streaming = false;
      this.currentAbortController = null;
    }

    // ── Append assistant turn to history ───────────────────────────────────
    if (assistantContent.trim()) {
      this.history.push({ role: 'assistant', content: assistantContent });
      if (this.history.length > HISTORY_MAX) {
        this.history = this.history.slice(-HISTORY_MAX);
      }
    }
  }

  // ─── Private: SSE streaming ────────────────────────────────────────────────

  /**
   * Read the SSE response body, dispatch events to the terminal / bus.
   * Returns the accumulated assistant text content.
   */
  private async streamSSE(response: Response): Promise<string> {
    const body = response.body;
    if (!body) throw new Error('Response body is null');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double-newline
      const parts = buffer.split('\n\n');
      // Last entry is a partial event or empty; keep as buffer tail
      buffer = parts[parts.length - 1] ?? '';

      for (const part of parts.slice(0, -1)) {
        const eventData = SSEClient.parseSSEBlock(part);
        if (eventData === null) continue;

        try {
          const evt = JSON.parse(eventData) as SSEEvent;
          assistantContent += this.handleSSEEvent(evt);
        } catch (parseErr) {
          log.warn('Failed to parse SSE event JSON', parseErr);
        }
      }
    }

    return assistantContent;
  }

  /**
   * Parse a raw SSE block (may have `event:` and `data:` lines).
   * Returns the data string, or null if no data found.
   */
  private static parseSSEBlock(block: string): string | null {
    let data: string | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        data = line.slice('data: '.length);
      }
      // We don't need the `event:` type line — type is in the JSON payload
    }
    return data;
  }

  /**
   * Dispatch a parsed SSE event to the terminal / bus.
   * Returns any assistant text content extracted from the event.
   */
  private handleSSEEvent(evt: SSEEvent): string {
    switch (evt.type) {
      case 'token': {
        const tokenEvt = evt as SSETokenEvent;
        this.streamBuf += tokenEvt.content;
        return tokenEvt.content;
      }

      case 'focus_item': {
        const focusEvt = evt as SSEFocusItemEvent;
        if (focusEvt.error) {
          this.terminal.writeln(
            '\r\n' + ANSI_RED + `focus_item error: ${focusEvt.error}` + ANSI_RESET,
          );
        } else if (!validatePath(focusEvt.path)) {
          this.terminal.writeln(
            '\r\n' + ANSI_RED + `Invalid path: ${focusEvt.path}` + ANSI_RESET,
          );
          log.warn('focus_item: invalid path rejected', focusEvt.path);
        } else {
          bus.emit(EVENT_TYPES.FOCUS_FILE, {
            path: focusEvt.path,
            triggerSource: 'agent',
          });
          log.info('focus_item emitted', focusEvt.path);
        }
        return '';
      }

      case 'search_results': {
        const searchEvt = evt as SSESearchResultsEvent;
        this.stopSpinner();
        this.writeSearchResults(searchEvt);
        this.hadSearchResults = true;
        this.startSpinner();
        return '';
      }

      case 'done': {
        const doneEvt = evt as SSEDoneEvent;
        this.stopSpinner();
        // Clear spinner line, optionally insert blank line after search results.
        this.terminal.write('\r\x1b[2K');
        if (this.hadSearchResults) this.terminal.write('\r\n');
        const validPaths = new Set(getAllPaths());
        const formatted = wrapAnsi(markdownToAnsi(this.streamBuf.trim(), validPaths), this.terminal.cols);
        this.terminal.writeln(formatted);

        // Muted provider/model footer
        if (doneEvt.provider || doneEvt.model) {
          const label = [doneEvt.provider, doneEvt.model].filter(Boolean).join(' · ');
          this.terminal.writeln('\r\n' + ANSI_DIM + '⚡ ' + label + ANSI_RESET);
        }

        // First-response free-model note
        if (this.responseCount === 0) {
          this.terminal.writeln(
            ANSI_DIM + ANSI_ITALIC +
            'ℹ  Free models power this agent. If responses seem off, try /model to switch.' +
            ANSI_RESET,
          );
        }
        this.responseCount++;

        this.terminal.write('\r\nagent> ');
        this.streamBuf = '';
        this.spinnerFrame = 0;
        this.hadSearchResults = false;
        this.wrapCol = 0;
        this.wordBuf = '';
        this.terminal.scrollToBottom();
        return '';
      }

      case 'error': {
        const errorEvt = evt as SSEErrorEvent;
        this.stopSpinner();
        this.terminal.writeln(ANSI_RED + `Error: ${errorEvt.message}` + ANSI_RESET);
        this.terminal.write('\r\nagent> ');
        this.terminal.scrollToBottom();
        return '';
      }

      default:
        log.warn('Unknown SSE event type', (evt as { type: string }).type);
        return '';
    }
  }

  /**
   * Write text to the terminal with word-aware wrapping.
   *
   * Because the backend streams one word per token, we can't peek ahead within
   * a single call. Instead we buffer the current word in `wordBuf` and only
   * flush it to the terminal when we hit a space or newline — at that point we
   * know the full word and can decide whether it fits on the current line.
   */
  private writeWrapped(text: string): void {
    const cols = this.terminal.cols;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n' || ch === '\r') {
        this.flushWordBuf();
        this.terminal.write('\r\n');
        this.wrapCol = 0;
        continue;
      }
      if (ch === ' ') {
        // Flush the buffered word now that we know its full length.
        this.flushWordBuf();
        // Always emit the space (or swap for \r\n if at column edge).
        // The trailing-space case must NOT be skipped — the next token starts
        // a new word that needs this space (or break) as a separator.
        if (this.wrapCol + 1 >= cols) {
          this.terminal.write('\r\n');
          this.wrapCol = 0;
        } else {
          this.terminal.write(' ');
          this.wrapCol++;
        }
        continue;
      }
      this.wordBuf += ch;
    }
    // Don't flush here — the word may continue in the next token.
  }

  /** Start the braille spinner animating on a 100ms interval. */
  private startSpinner(): void {
    this.stopSpinner();
    this.spinnerTimer = setInterval(() => {
      const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length]!;
      this.spinnerFrame++;
      this.terminal.write(`\r\x1b[2K${ANSI_DIM}${frame} thinking…${ANSI_RESET}`);
    }, 100);
  }

  /** Stop the spinner and clear its line. */
  private stopSpinner(): void {
    if (this.spinnerTimer !== null) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.terminal.write('\r\x1b[2K');
  }

  /** Flush the buffered word to the terminal, breaking before it if needed. */
  private flushWordBuf(): void {
    if (!this.wordBuf) return;
    const cols = this.terminal.cols;
    if (this.wrapCol + this.wordBuf.length > cols) {
      this.terminal.write('\r\n');
      this.wrapCol = 0;
    }
    this.terminal.write(this.wordBuf);
    this.wrapCol += this.wordBuf.length;
    this.wordBuf = '';
  }

  /** Format and write search results to the terminal. */
  private writeSearchResults(evt: SSESearchResultsEvent): void {
    const { results } = evt;
    if (!results || results.length === 0) {
      this.terminal.writeln(ANSI_YELLOW + 'No results found.' + ANSI_RESET);
      return;
    }

    for (const result of results) {
      this.wrapCol = 0;
      // Red colon prefix to indicate the file was read.
      this.terminal.write(`${ANSI_RED}:${ANSI_RESET} ${ANSI_BOLD}${result.path}${ANSI_RESET} ${ANSI_DIM}`);
      this.wrapCol = result.path.length + 3; // ': ' + path + ' '
      this.writeWrapped(result.title);
      this.flushWordBuf();
      this.terminal.write(`${ANSI_RESET}\r\n`);
      this.wrapCol = 0;
    }
  }
}
