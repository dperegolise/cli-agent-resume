/**
 * src/types.ts — Shared TypeScript type definitions
 * Single source of truth for all interfaces used across modules.
 * No dependencies — purely types.
 */

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface ManifestEntry {
  /** Unique identifier; derived from file path. e.g., "projects/my-project.md" */
  path: string;
  /** Display name extracted from front-matter or first H1. */
  title: string;
  /** Breadcrumb trail. e.g., ["projects"] */
  sections: string[];
  /** First 150 characters of content (stripped of front-matter). */
  excerpt: string;
  /** SHA-256 first 12 chars of file content. */
  hash: string;
}

export interface Manifest {
  entries: ManifestEntry[];
  /** ISO 8601 timestamp of when the manifest was built. */
  buildDate: string;
  /** Schema version, currently "1.0". */
  version: string;
}

// ─── Theme ───────────────────────────────────────────────────────────────────

export interface ThemeColors {
  /** Terminal background. */
  bg: string;
  /** Default foreground text. */
  fg: string;
  /** Cursor color. */
  cursor: string;
  /** Selection highlight. */
  selection: string;
  /** 16 ANSI colors: [black, red, green, yellow, blue, magenta, cyan, white,
   *  bright-black, bright-red, bright-green, bright-yellow, bright-blue,
   *  bright-magenta, bright-cyan, bright-white] */
  ansi: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
  /** Accent color used for tmux-style dividers and UI highlights.
   *  Varies per theme so dividers match the active palette. */
  accentColor: string;
  /** Optional pane-divider color. When set, dividers use this instead of the
   *  accent (the default theme wants near-invisible 1px separators). */
  dividerColor?: string;
}

export interface ThemeConfig {
  name: string;
  colors: ThemeColors;
}

// ─── Event Bus Payloads ───────────────────────────────────────────────────────

/** Emitted when the agent or CLI wants to open a file in the editor. */
export interface FocusFileEvent {
  /** e.g., "projects/project-name.md" */
  path: string;
  /** Optional line to scroll to. */
  lineNumber?: number;
  /** Which panel triggered the navigation. */
  triggerSource: 'agent' | 'cli' | 'explorer';
}

/** Emitted when the active theme changes. */
export interface ThemeChangeEvent {
  /** e.g., "nord" */
  themeName: string;
}

/** Emitted by editor when content/cursor changes (read-only, mostly informational). */
export interface EditorSyncEvent {
  path: string;
  content: string;
  cursorPosition: number;
}

/** Emitted by explorer when user navigates to highlight a path. */
export interface ExplorerHighlightEvent {
  path: string;
}

/** Emitted by CLI drawer after receiving search results from the backend. */
export interface SearchResultsEvent {
  query: string;
  results: SearchResult[];
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  /** File path, e.g. "experience/senior-engineer.md" */
  path: string;
  /** Display title. */
  title: string;
  /** 100-char preview of matching content. */
  excerpt: string;
  /** Section category, e.g. "experience", "projects", "about". */
  section: string;
  /** Relevance score 0–1. */
  score: number;
}

// ─── SSE Wire Protocol ────────────────────────────────────────────────────────

/** Single chat message in the conversation history. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** POST /agent request body. */
export interface AgentRequest {
  messages: ChatMessage[];
  session_id: string;
}

/** SSE event: streaming token from the agent. */
export interface SSETokenEvent {
  type: 'token';
  content: string;
}

/** SSE event: agent called focus_item tool. */
export interface SSEFocusItemEvent {
  type: 'focus_item';
  path: string;
  error: string | null;
}

/** SSE event: agent called search_portfolio tool. */
export interface SSESearchResultsEvent {
  type: 'search_results';
  results: SearchResult[];
}

/** SSE event: stream complete. */
export interface SSEDoneEvent {
  type: 'done';
  model?: string;
  provider?: string;
}

/** SSE event: error occurred. */
export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

/** Union of all SSE event types. */
export type SSEEvent =
  | SSETokenEvent
  | SSEFocusItemEvent
  | SSESearchResultsEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ─── Agent Message Types ──────────────────────────────────────────────────────

/** LangChain-style tool call message. */
export interface ToolCallMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** Agent system message (server-side only; never sent to client). */
export interface SystemMessage {
  role: 'system';
  content: string;
}
