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
import { validatePath } from '../manifest.js';
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
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RESET = '\x1b[0m';

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

  /** Abort the current streaming request (Ctrl+C). */
  abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.streaming = false;
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

    // ── Append user turn to history ────────────────────────────────────────
    this.history.push({ role: 'user', content: msg });
    // Keep rolling window
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
        headers: { 'Content-Type': 'application/json' },
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
    this.wrapCol = 0;
    this.wordBuf = '';
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
        this.writeWrapped(tokenEvt.content);
        this.terminal.scrollToBottom();
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
        this.writeSearchResults(searchEvt);
        return '';
      }

      case 'done': {
        const _done = evt as SSEDoneEvent;
        void _done;
        this.flushWordBuf();
        this.wrapCol = 0;
        this.wordBuf = '';
        this.terminal.write('\r\n\r\nagent> ');
        this.terminal.scrollToBottom();
        return '';
      }

      case 'error': {
        const errorEvt = evt as SSEErrorEvent;
        this.terminal.writeln(
          '\r\n' + ANSI_RED + `Error: ${errorEvt.message}` + ANSI_RESET,
        );
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
        // Emit the space, or turn it into a line break if we're near the edge
        // and more text is coming (non-trailing space).
        if (i < text.length - 1) {
          if (this.wrapCol + 1 >= cols) {
            this.terminal.write('\r\n');
            this.wrapCol = 0;
          } else {
            this.terminal.write(' ');
            this.wrapCol++;
          }
        }
        continue;
      }
      this.wordBuf += ch;
    }
    // Don't flush here — the word may continue in the next token.
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
      this.terminal.writeln('\r\n' + ANSI_YELLOW + 'No results found.' + ANSI_RESET);
      return;
    }

    this.terminal.writeln('');
    for (const result of results) {
      this.terminal.writeln(
        `\x1b[2m·\x1b[0m \x1b[33m${result.path}\x1b[0m \x1b[2m${result.title}\x1b[0m`,
      );
    }
  }
}
