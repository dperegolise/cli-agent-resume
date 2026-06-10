# CLI Portfolio — Technical Strategy (m0)

**Date**: 2026-06-08  
**Milestone**: m0  
**Status**: Strategy (non-implementable; guides all worker milestones)

---

## 1. Repository Structure

Final directory layout after `vite build` and all milestones complete:

```
cli-agent-resume/
├── .claude/
│   ├── CLAUDE.md
│   ├── teamwork-contract.md
│   ├── worktrees/                    # (git-ignored, created during builds)
│   │   ├── m1/
│   │   ├── m2/
│   │   └── ...
│   └── ...
├── .gitignore
├── .teamwork/
│   ├── intent/
│   │   └── objective.md
│   ├── strategy/
│   │   └── strategy-m0.md            # THIS FILE
│   ├── reports/
│   │   ├── m1.md
│   │   ├── m2.md
│   │   ├── review-m*.md
│   │   ├── critic-m*.md
│   │   ├── integrate-m*.md
│   │   ├── audit-*.md
│   │   ├── audit-PASS                # Completion gate
│   │   └── final-summary.md
│   ├── state/
│   │   └── run-state.json            # Durable run state
│   ├── handoff/
│   │   ├── latest.json
│   │   └── orchestrator-*.json
│   ├── heartbeats/
│   └── logs/
│       └── events-*.jsonl
├── src/
│   ├── index.ts                      # Single entry point
│   ├── types.ts                      # Shared type definitions
│   ├── theme.ts                      # Theme management & CSS vars
│   ├── bus.ts                        # Cross-panel event bus (owned by m4)
│   ├── manifest.ts                   # Manifest loading & validation
│   ├── agent/
│   │   ├── terminal.ts               # xterm.js wrapper (m3)
│   │   ├── sseClient.ts              # SSE stream handler (m3)
│   │   └── motd.ts                   # Welcome sequence (m3)
│   ├── editor/
│   │   ├── vim.ts                    # CodeMirror 6 + vim bindings (m4)
│   │   ├── statusBar.ts              # Powerline status bar DOM (m4)
│   │   └── fileLoader.ts             # Markdown file loading (m4)
│   ├── explorer/
│   │   ├── tree.ts                   # NERDTree DOM component (m4)
│   │   └── treeNav.ts                # Keyboard navigation (m4)
│   ├── drawer/
│   │   ├── terminal.ts               # xterm.js CLI instance (m5)
│   │   ├── commands.ts               # Command interpreter (m5)
│   │   ├── completion.ts             # Tab completion (m5)
│   │   └── history.ts                # Command history (m5)
│   ├── layout/
│   │   ├── responsive.ts             # Mobile breakpoint logic (m2)
│   │   └── style.css                 # Grid, flexbox, global styles (m2)
│   └── utils/
│       ├── types.ts                  # Utility type definitions
│       └── logging.ts                # Client-side logging
├── www/
│   ├── index.md                      # Portfolio landing (user-provided)
│   ├── about.md                      # About page (user-provided)
│   ├── contact.md                    # Contact page (user-provided)
│   ├── experience/
│   │   ├── index.md                  # Experience overview (user-provided)
│   │   └── *.md                      # One per role (user-provided)
│   └── projects/
│       ├── index.md                  # Projects overview (user-provided)
│       └── *.md                      # One per project (user-provided)
├── backend/
│   ├── main.py                       # FastAPI app entry (m6)
│   ├── agent.py                      # LangChain agent loop (m6)
│   ├── models.py                     # Request/response Pydantic models (m6)
│   ├── cascade.py                    # Model provider cascade logic (m6, m7)
│   ├── limiter.py                    # Rate limiter & ban logic (m6)
│   ├── manifest.py                   # Manifest loading at startup (m6)
│   ├── search.py                     # Full-text search indexing (m6)
│   └── tools.py                      # LangChain tool definitions (m6)
├── src/routr/
│   ├── main.py                       # FastAPI completions proxy (m7)
│   ├── providers.py                  # HuggingFace/local model routing (m7)
│   └── normalizer.py                 # OpenAI response normalization (m7)
├── deploy/
│   ├── portfolio-agent.service       # systemd unit (m8)
│   ├── nginx.conf                    # nginx reverse proxy config (m8)
│   ├── README.md                     # Deployment instructions (m8)
│   └── build.sh                      # Build & deploy script (m8)
├── dist/                             # (git-ignored; Vite output)
│   ├── index.html
│   ├── assets/
│   │   ├── index-[hash].js           # Main bundle
│   │   ├── manifest.json             # Static www/ manifest
│   │   ├── fonts/
│   │   │   └── JetBrainsMono-*.woff2 # CDN fallback
│   │   └── index-[hash].css
│   └── www/                          # Raw markdown text assets
│       ├── index.md
│       ├── about.md
│       └── ...
├── package.json
├── pnpm-lock.yaml                    # (if using pnpm; else package-lock.json)
├── tsconfig.json                     # TypeScript strict mode enabled
├── vite.config.ts                    # Manifest plugin + other config
├── pyproject.toml                    # Python backend (FastAPI/LangChain)
├── requirements.txt                  # Python pinned versions
├── INTENT.md                         # Design intent (original)
└── README.md                         # Project readme (for users)
```

### Key gitignore entries
```
dist/
node_modules/
.claude/worktrees/
*.pyc
__pycache__/
.env
.env.local
.venv/
venv/
```

---

## 2. Frontend Module Boundaries

Every TypeScript file has explicit responsibility and public API. All exports are named (no default exports) for clarity.

### `src/index.ts` — Main entry point
- **Responsibility**: Initialize app, mount DOM, orchestrate startup
- **Exports**:
  - `main(): Promise<void>` — async initialization routine
  - `onUnload(): void` — cleanup for hot module reload
- **Dependencies**: All other modules
- **Does not import from**: utilities only

### `src/types.ts` — Shared type definitions
- **Responsibility**: Single source of truth for all TypeScript interfaces
- **Exports**:
  - `ManifestEntry { path: string; title: string; sections: string[]; excerpt: string; hash: string }`
  - `Manifest { entries: ManifestEntry[]; buildDate: string }`
  - `ThemeConfig { name: string; colors: ThemeColors }`
  - `ThemeColors { bg: string; fg: string; cursor: string; ... 16 ANSI colors }`
  - `EventBusPayloads { FocusFileEvent, ThemeChangeEvent, ... }`
  - `SearchResult { path: string; title: string; excerpt: string; section: string; score: number }`
- **No dependencies** — purely types

### `src/theme.ts` — Theme management
- **Responsibility**: Manage active theme, CSS variables, broadcast changes
- **Exports**:
  - `class ThemeManager { getTheme(): ThemeConfig; setTheme(name: string): void; onThemeChange(cb): () => void }`
  - `THEME_NAMES: string[]` — `["gruvbox-dark", "nord", "tokyo-night"]`
  - `applyThemeCSSVars(theme: ThemeConfig): void` — updates `--tmux-green`, `--bg-main`, etc.
- **Imports**: `types.ts`
- **Emits to event bus**: `ThemeChangeEvent` (via `bus.ts`)
- **Global CSS variables**:
  - `--tmux-green: #44ff88` (divider color)
  - `--bg-main`, `--fg-main`, `--cursor`, `--selection` per theme
  - `--ansi-[0-15]` for 16 ANSI colors

### `src/bus.ts` — Cross-panel event bus
- **Responsibility**: Central event hub for agent shell → vim/explorer, and CLI drawer → vim/explorer
- **Exports**:
  - `class EventBus { emit<T>(type: string, payload: T): void; subscribe<T>(type: string, cb: (payload: T) => void): () => void }`
  - Event type constants:
    - `FOCUS_FILE_EVENT = "focus:file"` — `{ path: string; lineNumber?: number }`
    - `THEME_CHANGE_EVENT = "theme:change"` — `{ themeName: string }`
    - `EDITOR_SYNC_EVENT = "editor:sync"` — `{ content: string; path: string }`
    - `EXPLORER_HIGHLIGHT_EVENT = "explorer:highlight"` — `{ path: string }`
- **Single global instance**: `export const bus = new EventBus()`
- **Imports**: `types.ts`
- **Used by**: m3 (emits FOCUS_FILE_EVENT), m4 (consumes & emits), m5 (emits FOCUS_FILE_EVENT)

### `src/manifest.ts` — Manifest loading
- **Responsibility**: Load and validate static manifest at startup
- **Exports**:
  - `loadManifest(): Promise<Manifest>` — fetch `/assets/manifest.json`
  - `getManifestEntry(path: string): ManifestEntry | null`
  - `getAllPaths(): string[]` — all valid file paths
  - `validatePath(path: string): boolean` — security check (path must be in manifest)
- **Imports**: `types.ts`
- **Fetches**: `/assets/manifest.json` (generated by Vite plugin during build)

### `src/agent/terminal.ts` — xterm.js wrapper (m3-owned)
- **Responsibility**: Wrap xterm.js core, expose controlled write API, handle fonts/theme
- **Exports**:
  - `class AgentTerminal { open(element: HTMLElement): void; writeln(text: string): void; clear(): void; onData(cb): void }`
  - `attachTermTheme(term: Terminal, theme: ThemeConfig): void` — apply theme colors
- **Imports**: `types.ts`
- **Used by**: m3 initialization

### `src/agent/sseClient.ts` — SSE stream handler (m3)
- **Responsibility**: Manage SSE connection to `/agent` endpoint, parse events, emit to terminal + bus
- **Exports**:
  - `class SSEClient { connect(sessionId: string): Promise<void>; sendMessage(msg: string): Promise<void>; close(): void }`
  - Event handler: `onFocusItemEvent(event: { path: string }): void` — emits to bus
- **Imports**: `types.ts`, `bus.ts`, `manifest.ts`
- **Sends to backend**: `POST /agent { messages: [...], session_id: string }`
- **Receives**: `text/event-stream` with `data: {"type": "token"|"focus_item"|"done"|"error", ...}`

### `src/agent/motd.ts` — Welcome sequence (m3)
- **Responsibility**: Print ASCII art MOTD, clickable options [1] [2] [3] [4]
- **Exports**:
  - `printMOTD(terminal: AgentTerminal): void`
  - `createClickableLinks(linkText: string, path: string): HTMLElement`
- **Imports**: `types.ts`, `bus.ts`
- **Behavior**: Links emit FOCUS_FILE_EVENT to bus when clicked

### `src/editor/vim.ts` — CodeMirror 6 + Vim (m4)
- **Responsibility**: Create and manage CodeMirror editor with Vim keybindings
- **Exports**:
  - `class VimEditor { create(element: HTMLElement, theme: ThemeConfig): void; loadFile(path: string, content: string): void; getState(): EditorState }`
  - `isReadOnly(): boolean` — always true; all edit ops show toast
- **Imports**: `types.ts`, `bus.ts`, `theme.ts`
- **Listens to**: FOCUS_FILE_EVENT from bus → calls `loadFile()`
- **Emits to**: theme bus events
- **CodeMirror extensions**:
  - `vim()` from `@replit/codemirror-vim`
  - `markdown()` from `@codemirror/lang-markdown`
  - `readOnly` extension (from theme)

### `src/editor/statusBar.ts` — Powerline status bar (m4)
- **Responsibility**: Render fancy Vim status bar DOM element below editor
- **Exports**:
  - `class PowerlineBar { update(state: EditorState, theme: ThemeConfig): void }`
  - DOM structure spec: (see section 11 below)
- **Imports**: `types.ts`, `theme.ts`
- **Listens to**: Editor state changes via CodeMirror extension hook
- **Updates on**: mode changes, file path changes, line/col changes, scroll position

### `src/editor/fileLoader.ts` — File loading (m4)
- **Responsibility**: Fetch markdown files from `/assets/` or `/www/`
- **Exports**:
  - `loadFileContent(path: string): Promise<string>`
  - `getDefaultFile(): string` — returns `www/index.md` content
- **Imports**: `manifest.ts` (validates path)
- **Fetches**: `/assets/www/{path}.md` (raw text asset) or `/www/{path}.md` (dev fallback)

### `src/explorer/tree.ts` — NERDTree DOM (m4)
- **Responsibility**: Build and render file tree from manifest
- **Exports**:
  - `class FileExplorer { render(element: HTMLElement, manifest: Manifest): void; highlight(path: string): void; getSelectedPath(): string }`
  - `buildTreeDOM(manifest: Manifest): HTMLElement` — returns `<div class="nerd-tree">...</div>`
- **Imports**: `types.ts`, `bus.ts`, `manifest.ts`
- **Listens to**: FOCUS_FILE_EVENT and EXPLORER_HIGHLIGHT_EVENT from bus
- **Emits to**: FOCUS_FILE_EVENT when user clicks or presses Enter
- **Keyboard shortcuts**: `j`/`k` (move), `Enter` (select), `o` (future split), `?` (help)

### `src/explorer/treeNav.ts` — Keyboard navigation (m4)
- **Responsibility**: Handle j/k/Enter/Escape in tree view
- **Exports**:
  - `class TreeNavigator { attach(treeElement: HTMLElement): void; moveCursor(direction: 'up'|'down'): void; selectCurrent(): void }`
- **Imports**: `types.ts`, `bus.ts`
- **No direct DOM mutations** — delegates to FileExplorer via bus emissions

### `src/drawer/terminal.ts` — CLI terminal (m5)
- **Responsibility**: Manage xterm.js instance in CLI drawer, expose write + read API
- **Exports**:
  - `class CLITerminal { open(element: HTMLElement): void; writeln(text): void; readLine(): Promise<string>; clear(): void }`
  - `setupCollapseListener(divider: HTMLElement, drawer: HTMLElement): void`
- **Imports**: `types.ts`, `theme.ts`

### `src/drawer/commands.ts` — Command interpreter (m5)
- **Responsibility**: Parse and execute CLI commands (help, ls, view, search, theme, etc.)
- **Exports**:
  - `class CommandHandler { execute(cmd: string, args: string[]): Promise<string> }`
  - Commands:
    - `help` → list commands
    - `ls [section]` → list files
    - `view <path>` → open in editor (emits FOCUS_FILE_EVENT to bus)
    - `search <query>` → search portfolio (calls `/agent` backend search)
    - `theme <name>` → switch theme
    - `clear` → clear terminal
    - `about`, `projects`, `contact` → shortcuts
- **Imports**: `types.ts`, `bus.ts`, `manifest.ts`, `sseClient.ts`

### `src/drawer/completion.ts` — Tab completion (m5)
- **Responsibility**: Implement tab-completion for file paths and commands
- **Exports**:
  - `completeCommand(partial: string, manifest: Manifest): string[]` → matching paths or command names
- **Imports**: `manifest.ts`, `types.ts`

### `src/drawer/history.ts` — Command history (m5)
- **Responsibility**: Manage arrow-key history buffer (session-scoped)
- **Exports**:
  - `class CommandHistory { push(cmd: string): void; prev(): string; next(): string; reset(): void }`
- **No imports**

### `src/layout/responsive.ts` — Mobile breakpoint (m2)
- **Responsibility**: Detect viewport < 768px, hide/show panels, manage hamburger menu
- **Exports**:
  - `class MobileLayout { init(mainLayout: HTMLElement): void; toggleSidebar(): void; isMobile(): boolean }`
- **Imports**: `types.ts`
- **Modifies CSS classes** on root element: `is-mobile`, `sidebar-open`

### `src/layout/style.css` — Global styles (m2)
- **Responsibility**: Grid layout, tmux dividers, Gruvbox theme defaults, mobile media query
- **Contains**:
  - `body { display: grid; grid-template-columns: 320px 1fr; ... }`
  - `.divider { width: 1px; background: var(--tmux-green); }`
  - `.right-panel { display: grid; grid-template-rows: 1fr 3fr; }`
  - `.cli-drawer { grid-row: 3; height: 220px; transition: height 0.2s; }`
  - `@media (max-width: 768px) { .agent-shell { display: none; } ... }`

### `src/utils/logging.ts` — Client-side logging
- **Responsibility**: Structured logging with timestamp, level, module name
- **Exports**: `logger.info(msg, data)`, `logger.error()`, `logger.warn()`, `logger.debug()`

---

## 3. DOM Mount Points (HTML Element IDs)

All mount points are declared in `src/index.html` and referenced from TypeScript.

```html
<body id="app">
  <div id="agent-shell" class="panel left-panel">
    <!-- xterm.js AgentTerminal mounts here -->
  </div>
  
  <div id="divider-vertical" class="divider vertical"></div>
  
  <div id="right-panel" class="panel right-panel">
    <div id="file-explorer" class="panel top-panel">
      <!-- NERDTree DOM tree renders here -->
    </div>
    
    <div id="divider-horizontal" class="divider horizontal"></div>
    
    <div id="vim-editor-container" class="panel bottom-panel">
      <!-- CodeMirror mounts here -->
      <div id="vim-editor"></div>
      <!-- PowerlineBar renders below CM -->
      <div id="powerline-status-bar" class="powerline"></div>
    </div>
  </div>
  
  <div id="divider-bottom" class="divider horizontal"></div>
  
  <div id="cli-drawer" class="panel cli-drawer">
    <!-- xterm.js CLITerminal mounts here -->
  </div>
  
  <!-- Mobile hamburger (hidden on desktop) -->
  <button id="hamburger-menu" class="hamburger" aria-label="Toggle file explorer">☰</button>
  
  <!-- Mobile sidebar (position: fixed, z-index high) -->
  <aside id="mobile-sidebar" class="sidebar-drawer">
    <!-- Copy of file-explorer DOM, hidden on desktop -->
    <div id="mobile-file-explorer"></div>
  </aside>
</body>
```

**ID reference table**:
| ID | Panel | Module Owner | Content |
|---|---|---|---|
| `agent-shell` | Left | m3 | xterm.js AgentTerminal |
| `file-explorer` | Top-right | m4 | NERDTree DOM |
| `vim-editor` | Bottom-right | m4 | CodeMirror 6 editor |
| `powerline-status-bar` | Bottom-right | m4 | Powerline status bar |
| `cli-drawer` | Bottom | m5 | xterm.js CLITerminal |
| `hamburger-menu` | Top-right | m2 | Mobile menu button |
| `mobile-sidebar` | Left (mobile) | m2 | Mobile file explorer overlay |

---

## 4. Cross-Panel Event Bus Contract

**File**: `src/bus.ts`  
**Owner**: m4 (vim-panel milestone)

### TypeScript Interface

```typescript
// Emitted by agent shell (m3) when tool calls focus_item
export interface FocusFileEvent {
  path: string;              // e.g., "projects/project-name.md"
  lineNumber?: number;       // optional; auto-scroll to line
  triggerSource: 'agent' | 'cli' | 'explorer'; // origin
}

// Emitted by theme manager when user selects theme
export interface ThemeChangeEvent {
  themeName: string;         // e.g., "nord"
}

// Emitted by editor when content changes (rarely; mostly read-only)
export interface EditorSyncEvent {
  path: string;
  content: string;
  cursorPosition: number;
}

// Emitted by explorer when user navigates
export interface ExplorerHighlightEvent {
  path: string;
}

// Emitted by CLI drawer when search results are ready
export interface SearchResultsEvent {
  query: string;
  results: SearchResult[];
}
```

### EventBus API

```typescript
export class EventBus {
  // Emit an event
  emit<T>(eventType: string, payload: T): void;
  
  // Subscribe; returns unsubscribe function
  subscribe<T>(eventType: string, callback: (payload: T) => void): () => void;
  
  // Shorthand for one-time events
  once<T>(eventType: string, callback: (payload: T) => void): void;
}

// Global singleton instance
export const bus = new EventBus();

// Event type constants
export const EVENT_TYPES = {
  FOCUS_FILE: 'focus:file',
  THEME_CHANGE: 'theme:change',
  EDITOR_SYNC: 'editor:sync',
  EXPLORER_HIGHLIGHT: 'explorer:highlight',
  SEARCH_RESULTS: 'search:results',
} as const;
```

### Emission / Consumption Matrix

| Event | Emitted By | Consumed By | Trigger | Payload |
|-------|-----------|-----------|---------|---------|
| `FOCUS_FILE` | m3 (agent), m5 (CLI) | m4 (vim, explorer) | Agent `focus_item` tool, user `view <path>` | `FocusFileEvent` |
| `THEME_CHANGE` | m2 (theme mgr) | m2, m3, m4, m5 (all) | CLI `theme <name>`, theme switcher | `ThemeChangeEvent` |
| `EXPLORER_HIGHLIGHT` | m4 (explorer) | m4 (explorer) | Keyboard nav or bus emission | `ExplorerHighlightEvent` |
| `EDITOR_SYNC` | m4 (vim) | m4 (vim) | CodeMirror state listener | `EditorSyncEvent` |
| `SEARCH_RESULTS` | m5 (CLI) | m5 (CLI terminal) | `search <query>` command | `SearchResultsEvent` |

### Example: Agent focuses a file

1. Backend agent calls `focus_item(path="projects/cli.md")`
2. SSE event: `{"type": "focus_item", "path": "projects/cli.md"}`
3. m3 parses SSE, emits: `bus.emit(EVENT_TYPES.FOCUS_FILE, { path: "...", triggerSource: 'agent' })`
4. m4 vim editor subscribes, loads file: `editor.loadFile("projects/cli.md")`
5. m4 explorer subscribes, highlights row: `explorer.highlight("projects/cli.md")`

---

## 5. SSE Wire Contract (Frontend ↔ Backend)

**Endpoint**: `POST /agent`  
**Protocol**: Server-Sent Events (SSE)

### Request (Frontend → Backend)

```json
POST /agent
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "content": "Tell me about your projects"
    },
    {
      "role": "assistant",
      "content": "Here are my top projects..."
    }
  ],
  "session_id": "browser-session-uuid-v4"
}
```

- **`messages`**: array of `{ role: "user"|"assistant", content: string }`
  - This is the **full conversation history** sent by the browser (rolling window, max ~10 messages to save bandwidth)
  - Browser maintains history in sessionStorage or in-memory
- **`session_id`**: UUID v4, generated once per page load and reused for all calls
  - Used for rate limiting (tracked by IP, not session)

### Response (Backend → Frontend)

SSE stream with multiple event types:

#### 1. **token event** — streaming text output
```
event: token
data: {"type": "token", "content": "Here are my "}

event: token
data: {"type": "token", "content": "top projects..."}
```

- Multiple `token` events sent as LangChain agent streams output
- Frontend appends each to the terminal

#### 2. **focus_item event** — agent tool invocation result
```
event: focus_item
data: {"type": "focus_item", "path": "projects/my-startup.md", "error": null}
```

- Emitted when agent calls the `focus_item` tool
- `path`: absolute path in manifest (e.g., `"projects/my-startup.md"`)
- `error`: null on success, or string error message if path invalid
- Frontend emits this to the cross-panel bus (EVENT_TYPES.FOCUS_FILE)

#### 3. **search_results event** — agent tool invocation result
```
event: search_results
data: {
  "type": "search_results",
  "results": [
    {
      "path": "experience/senior-engineer.md",
      "title": "Senior Engineer at TechCorp",
      "excerpt": "Led a team of 5 engineers...",
      "section": "experience",
      "score": 0.95
    }
  ]
}
```

- Returned by `search_portfolio(query)` tool
- `score`: relevance score (0-1), higher = better match
- Can be multiple events if results are streamed
- Frontend displays in CLI drawer terminal

#### 4. **done event** — stream completion
```
event: done
data: {"type": "done"}
```

- Sent exactly once at the end of the SSE stream
- Signals to frontend that the agent turn is complete
- Frontend re-enables input prompt

#### 5. **error event** — stream error
```
event: error
data: {"type": "error", "message": "Rate limit exceeded. Banned for 24h."}
```

- SSE stream is closed immediately after
- Frontend displays error toast to user
- If rate limit error: close SSE and disable UI for 24h (check localStorage)

### Rate Limiting Headers (Optional)

Backend may include headers in SSE response:
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 15
X-RateLimit-Reset: 1717948800
X-Client-Banned-Until: 1717948800  (if rate limit breached)
```

Frontend reads these and updates UI state.

---

## 6. Agent Tool Schemas (LangChain)

These are the **only two tools** the agent has. Passed to the model provider.

### Tool 1: `search_portfolio`

**Type**: Synchronous retrieval (returns immediately)

```python
# Backend (LangChain tool definition)
@tool
def search_portfolio(query: str) -> List[Dict]:
    """
    Search the portfolio for content matching the query.
    Returns ranked results with location metadata.
    
    Args:
        query: Search string (e.g., "machine learning projects")
    
    Returns:
        List of search results, each with:
        - path: File path (e.g., "projects/ml-pipeline.md")
        - title: Display name
        - excerpt: 100-char preview of matching content
        - section: Category ("experience", "projects", "about")
        - score: Relevance score (0-1)
    """
    ...
```

**JSON Schema** (passed to OpenRouter / HuggingFace):
```json
{
  "type": "function",
  "function": {
    "name": "search_portfolio",
    "description": "Search the portfolio for content matching the query.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search string (e.g., 'machine learning projects')"
        }
      },
      "required": ["query"]
    }
  }
}
```

**Return Type** (Python):
```python
SearchResult = TypedDict('SearchResult', {
    'path': str,
    'title': str,
    'excerpt': str,
    'section': str,
    'score': float,
})
```

### Tool 2: `focus_item`

**Type**: Synchronous event emission (no return value)

```python
@tool
def focus_item(path: str) -> str:
    """
    Navigate to a portfolio item and highlight it in the UI.
    The browser will load the file in the editor and highlight it in the file explorer.
    
    Args:
        path: File path in the manifest (e.g., "projects/my-project.md")
    
    Returns:
        Confirmation message or error if path is invalid
    """
    ...
```

**JSON Schema**:
```json
{
  "type": "function",
  "function": {
    "name": "focus_item",
    "description": "Navigate to a portfolio item and highlight it in the UI.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "File path in the manifest (e.g., 'projects/my-project.md')",
          "pattern": "^[a-z0-9/_-]+\\.md$"
        }
      },
      "required": ["path"]
    }
  }
}
```

**Return Type**:
```python
# Returns string: either "Successfully navigated to {path}" or error message
```

### Path Validation Rule

- **Pattern**: `^[a-z0-9/_-]+\.md$` (lowercase alphanumeric, `/`, `-`, underscore, `.md` extension)
- **Runtime check**: Path must exist in the manifest (checked before emitting SSE event)
- **Invalid paths**: Logged, returned as error to agent, never sent to frontend

---

## 7. www/ Manifest Format

The manifest is a **static JSON file generated at build time** and served as a Vite asset.

### File Paths

**Build time**:
- Vite plugin scans `www/` directory
- Generates `/dist/assets/manifest.json`

**Runtime**:
- Frontend: loads from `/assets/manifest.json` (via `loadManifest()`)
- Backend: reads from `www/manifest.json` at startup (or from built dist manifest)

### TypeScript Type

```typescript
export interface ManifestEntry {
  // Unique identifier; derived from file path
  path: string;                    // e.g., "projects/my-project.md"
  
  // Display name (extracted from markdown front-matter or file name)
  title: string;                   // e.g., "My Cool Project"
  
  // Breadcrumb trail
  sections: string[];              // e.g., ["projects"]
  
  // First 150 characters of content (for search preview)
  excerpt: string;
  
  // File hash (for cache busting)
  hash: string;
}

export interface Manifest {
  entries: ManifestEntry[];
  buildDate: string;              // ISO 8601 timestamp
  version: string;                // e.g., "1.0"
}
```

### JSON Example

```json
{
  "entries": [
    {
      "path": "index.md",
      "title": "Portfolio Home",
      "sections": [],
      "excerpt": "Senior software engineer with 10+ years...",
      "hash": "abc123def456"
    },
    {
      "path": "about.md",
      "title": "About Me",
      "sections": [],
      "excerpt": "I specialize in full-stack development...",
      "hash": "xyz789uvw012"
    },
    {
      "path": "experience/senior-engineer.md",
      "title": "Senior Engineer at TechCorp",
      "sections": ["experience"],
      "excerpt": "Led a team of 5 engineers building...",
      "hash": "qwe345rty678"
    },
    {
      "path": "projects/index.md",
      "title": "Projects Overview",
      "sections": ["projects"],
      "excerpt": "A collection of my recent work...",
      "hash": "asd901fgh234"
    },
    {
      "path": "projects/cli-agent.md",
      "title": "CLI Agent Portfolio",
      "sections": ["projects"],
      "excerpt": "Browser-based terminal portfolio...",
      "hash": "zxc567bnm890"
    }
  ],
  "buildDate": "2026-06-08T14:22:33Z",
  "version": "1.0"
}
```

### Vite Plugin (Manifest Generation)

**File**: `vite.config.ts`

```typescript
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'generate-manifest',
      apply: 'build',
      async generateBundle() {
        // Scan www/ directory
        const wwwDir = 'www';
        const entries: ManifestEntry[] = [];
        
        function scanDir(dir: string, section: string[] = []) {
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
              scanDir(fullPath, [...section, file.name]);
            } else if (file.name.endsWith('.md')) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const relPath = path
                .relative(wwwDir, fullPath)
                .replace(/\\/g, '/')
                .replace(/^index\.md$/, 'index');
              
              entries.push({
                path: relPath.endsWith('.md') ? relPath : relPath + '.md',
                title: extractTitle(content) || file.name,
                sections: section,
                excerpt: content.slice(0, 150).trim(),
                hash: hashContent(content),
              });
            }
          }
        }
        
        scanDir(wwwDir);
        
        const manifest: Manifest = {
          entries,
          buildDate: new Date().toISOString(),
          version: '1.0',
        };
        
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(manifest, null, 2),
        });
      },
    },
  ],
});
```

### Backend Manifest Loading

**File**: `backend/manifest.py`

```python
import json
from pathlib import Path
from typing import List, Dict

class Manifest:
    def __init__(self, manifest_path: str = "www/manifest.json"):
        with open(manifest_path, 'r') as f:
            self.data = json.load(f)
        self.entries = {entry['path']: entry for entry in self.data['entries']}
    
    def get_all_paths(self) -> List[str]:
        """Return all valid file paths."""
        return list(self.entries.keys())
    
    def validate_path(self, path: str) -> bool:
        """Check if path exists in manifest."""
        return path in self.entries
    
    def get_entry(self, path: str) -> Dict:
        """Return entry metadata."""
        return self.entries.get(path)
    
    def search(self, query: str) -> List[Dict]:
        """Full-text search implementation (see section 7.2)."""
        ...
```

---

## 8. Library Version Pins

All versions chosen as of June 2026, pinned to exact stable releases (with minor version tolerance for bugfixes).

### Frontend (npm/pnpm)

```json
{
  "dependencies": {
    "@xterm/xterm": "6.0.0",
    "@xterm/addon-fit": "0.11.0",
    "@xterm/addon-web-links": "0.12.0",
    "@codemirror/view": "6.28.0",
    "@codemirror/state": "6.4.0",
    "@codemirror/lang-markdown": "6.2.0",
    "@replit/codemirror-vim": "6.3.0",
    "vite": "8.0.16"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "vite": "8.0.16"
  }
}
```

**Why these versions**:
- **xterm.js 6.0.0**: Latest major release; stable API
- **xterm addons 0.11+, 0.12+**: Match xterm.js 6.x ecosystem
- **CodeMirror 6.x**: Latest stable (6.28 published ~May 2026)
- **@replit/codemirror-vim 6.3.0**: Latest stable vim bindings for CM6
- **Vite 8.0.16**: Latest (released June 2026); supports Rolldown bundler
- **TypeScript 5.9.3**: Latest; strict mode recommended

### Backend (Python)

```text
# requirements.txt
fastapi==0.136.1
uvicorn[standard]==0.40.0
langchain==1.3.4
langchain-core==1.4.1
langchain-community==0.4.2
httpx==0.28.1
python-dotenv==1.0.1
pydantic==2.7.4
aiofiles==23.2.1
```

**Why these versions**:
- **FastAPI 0.136.1**: Latest stable (April 2026); requires Python 3.10+
- **Uvicorn 0.40.0**: Latest stable; included with `fastapi[standard]`
- **LangChain 1.3.4**: Latest stable (June 2026); 1.x is stable
- **langchain-core 1.4.1**: Latest (June 2026); decoupled from main package
- **langchain-community 0.4.2**: Being sunset; last version usable
- **httpx 0.28.1**: Latest stable (December 2024 base, no newer releases in 2026)
- **python-dotenv 1.0.1**: Stable for `.env` files
- **Pydantic 2.7.4**: Latest; used by FastAPI for validation

**Python baseline**: 3.12 (recommended for 2026; 3.10+ required)

### Dev dependencies (optional, for monorepo builds)

```text
# backend/requirements-dev.txt
pytest==7.4.4
pytest-asyncio==0.24.0
black==24.3.0
ruff==0.4.8
```

---

## 9. Model Cascade Design

The agent backend tries multiple model providers in fallback order. **Tools are never sent to `src/routr`**.

### Model Cascade Sequence

```
┌─────────────────────────────────────────────────────┐
│ User message arrives via SSE POST /agent            │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
      ┌──────────────────────────────────┐
      │ OpenRouter free-tier models      │ (env: OPENROUTER_API_KEY)
      │ (or configured model list)       │
      └────────────┬─────────────────────┘
                   │
            ┌──────▼───────┐
            │  Available?  │
            └──┬─────────┬──┘
            yes│        │no
               │        │
         ┌─────▼──┐    │
         │ Send   │    │
         │ + TOOLS│    │
         └─────┬──┘    │
               │       │
               │  ┌────▼─────────────────────────────────┐
               │  │ HuggingFace Inference API free       │
               │  │ (env: HUGGINGFACE_API_KEY)           │
               │  └────────┬─────────────────────────────┘
               │           │
               │    ┌──────▼───────┐
               │    │  Available?  │
               │    └──┬─────────┬──┘
               │    yes│        │no
               │       │        │
               │  ┌────▼──┐    │
               │  │ Send  │    │
               │  │+ TOOLS│    │
               │  └────┬──┘    │
               │       │       │
               │       │  ┌────▼──────────────────────┐
               │       │  │ src/routr completions    │
               │       │  │ proxy (local :8000)      │
               │       │  │ NO TOOLS, text-only      │
               │       │  └────────┬─────────────────┘
               │       │           │
               │       │    ┌──────▼────────┐
               │       │    │  Available?   │
               │       │    └┬───────────┬──┘
               │       │    │          │
               │   ┌───▼┐   │          │
               │   │   │   │    ┌─────▼────────────┐
               │   │   │   │    │ Agent tool call  │
               │   │   │   │    │ fails; error to  │
               │   │   │   │    │ user             │
               │   │   │   │    └──────────────────┘
               │   │   │   │
               │   └───┼───┴─► Parse response
               │       │      Apply tool calls
               │       │      (search_portfolio,
               │       │       focus_item)
               │       │
               │       └──────────────────────┐
               │                              │
               └──────────────────────────────┴─────────────────────┐
                                              │
                                              ▼
                              Stream response tokens to client
                              Emit tool call SSE events
                              Emit "done" event
```

### Provider Switching Logic

**File**: `backend/cascade.py`

```python
import os
from typing import List, Dict, Any
from enum import Enum

class Provider(Enum):
    OPENROUTER = "openrouter"
    HUGGINGFACE = "huggingface"
    ROUTR = "routr"

class ModelCascade:
    def __init__(self):
        # Load from env vars
        self.openrouter_key = os.getenv('OPENROUTER_API_KEY')
        self.openrouter_models = os.getenv('OPENROUTER_MODELS', 'gpt-4-mini,llama-2-7b-chat').split(',')
        
        self.huggingface_key = os.getenv('HUGGINGFACE_API_KEY')
        self.huggingface_model = os.getenv('HUGGINGFACE_MODEL', 'mistralai/Mistral-7B-Instruct-v0.1')
        
        self.routr_url = os.getenv('ROUTR_URL', 'http://localhost:8000')
    
    async def get_available_provider(self) -> Provider:
        """Try providers in order; return first available."""
        providers = [Provider.OPENROUTER, Provider.HUGGINGFACE, Provider.ROUTR]
        
        for provider in providers:
            if await self.is_available(provider):
                return provider
        
        raise Exception("No model provider available")
    
    async def is_available(self, provider: Provider) -> bool:
        """Health check for provider."""
        if provider == Provider.OPENROUTER:
            return bool(self.openrouter_key)
        elif provider == Provider.HUGGINGFACE:
            return bool(self.huggingface_key)
        elif provider == Provider.ROUTR:
            # Try HTTP request to /health or /v1/models
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{self.routr_url}/health", timeout=2)
                return resp.status_code == 200
            except:
                return False
    
    async def call_model(self, messages: List[Dict], tools: List[Dict]):
        """Call the best available provider."""
        provider = await self.get_available_provider()
        
        if provider == Provider.OPENROUTER:
            return await self.call_openrouter(messages, tools)
        elif provider == Provider.HUGGINGFACE:
            return await self.call_huggingface(messages, tools)
        elif provider == Provider.ROUTR:
            # NEVER pass tools to routr
            return await self.call_routr(messages, tools=None)
    
    async def call_openrouter(self, messages: List[Dict], tools: List[Dict]):
        """Call OpenRouter with tool definitions."""
        async with httpx.AsyncClient() as client:
            payload = {
                'model': self.openrouter_models[0],
                'messages': messages,
                'tools': tools,                    # ← INCLUDE TOOLS
                'tool_choice': 'auto',
                'temperature': 0.7,
                'max_tokens': 2048,
            }
            
            async with client.stream(
                'POST',
                'https://openrouter.ai/api/v1/chat/completions',
                json=payload,
                headers={
                    'Authorization': f'Bearer {self.openrouter_key}',
                    'HTTP-Referer': 'https://portfolio.example.com',
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith('data:'):
                        # Parse SSE delta
                        yield ...
    
    async def call_huggingface(self, messages: List[Dict], tools: List[Dict]):
        """Call HuggingFace Inference API with tool definitions."""
        # Similar structure to OpenRouter
        # Tools passed if supported by model
        ...
    
    async def call_routr(self, messages: List[Dict], tools: None):
        """Call local routr completions proxy. NEVER pass tools."""
        assert tools is None, "routr is text-only; no tools allowed"
        
        # Convert chat messages to completion format
        prompt = self.messages_to_prompt(messages)
        
        async with httpx.AsyncClient() as client:
            payload = {
                'model': 'local',
                'prompt': prompt,
                'temperature': 0.7,
                'max_tokens': 2048,
                # NO 'tools' field
            }
            
            async with client.stream(
                'POST',
                f'{self.routr_url}/v1/completions',
                json=payload,
            ) as resp:
                # Parse SSE response
                ...
```

### Environment Variables (Backend)

```bash
# .env.example
OPENROUTER_API_KEY=sk-...
OPENROUTER_MODELS=gpt-4-mini,meta-llama/llama-2-7b-chat-hf

HUGGINGFACE_API_KEY=hf_...
HUGGINGFACE_MODEL=mistralai/Mistral-7B-Instruct-v0.1

ROUTR_URL=http://localhost:8000

# Rate limiting
AGENT_RATE_LIMIT=20           # requests per 60 seconds
AGENT_BAN_DURATION_HOURS=24   # IP ban TTL
```

---

## 10. Rate Limiter & Ban Design

**File**: `backend/limiter.py`

### Data Structures

```python
from collections import deque
from datetime import datetime, timedelta
from typing import Dict

class RateLimiter:
    def __init__(self, limit: int = 20, window_seconds: int = 60, ban_hours: int = 24):
        """
        Args:
            limit: max requests per window (default 20)
            window_seconds: sliding window size (default 60)
            ban_hours: IP ban duration (default 24)
        """
        self.limit = limit
        self.window_seconds = window_seconds
        self.ban_hours = ban_hours
        
        # Sliding window: {ip: deque([timestamp, timestamp, ...])}
        self.requests: Dict[str, deque] = {}
        
        # Ban list: {ip: expiry_timestamp}
        self.bans: Dict[str, datetime] = {}
    
    def check_and_record(self, client_ip: str) -> bool:
        """
        Check if client is rate-limited or banned.
        If allowed, record the request.
        
        Returns:
            True if request is allowed
            False if rate limited or banned
        """
        now = datetime.now()
        
        # Check ban list
        if client_ip in self.bans:
            if self.bans[client_ip] > now:
                return False  # Still banned
            else:
                del self.bans[client_ip]  # Ban expired
        
        # Sliding window check
        if client_ip not in self.requests:
            self.requests[client_ip] = deque()
        
        window = self.requests[client_ip]
        
        # Remove timestamps outside the window
        cutoff = now - timedelta(seconds=self.window_seconds)
        while window and window[0] < cutoff:
            window.popleft()
        
        # Check limit
        if len(window) >= self.limit:
            # Rate limit exceeded; ban the IP
            self.bans[client_ip] = now + timedelta(hours=self.ban_hours)
            # Clear request history
            del self.requests[client_ip]
            return False
        
        # Request allowed; record it
        window.append(now)
        return True
    
    def is_banned(self, client_ip: str) -> bool:
        """Check if IP is currently banned."""
        if client_ip not in self.bans:
            return False
        if self.bans[client_ip] > datetime.now():
            return True
        del self.bans[client_ip]
        return False
    
    def get_ban_expiry(self, client_ip: str) -> datetime:
        """Return ban expiry time or None."""
        return self.bans.get(client_ip)
```

### FastAPI Integration

**File**: `backend/main.py`

```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()
limiter = RateLimiter(
    limit=int(os.getenv('AGENT_RATE_LIMIT', '20')),
    ban_hours=int(os.getenv('AGENT_BAN_DURATION_HOURS', '24')),
)

@app.post("/agent")
async def agent_endpoint(request: Request, body: AgentRequest):
    client_ip = request.client.host
    
    # Check rate limit
    if not limiter.check_and_record(client_ip):
        ban_expiry = limiter.get_ban_expiry(client_ip)
        return StreamingResponse(
            iter([
                f'event: error\n'
                f'data: {{"type": "error", '
                f'"message": "Rate limit exceeded. Banned until {ban_expiry.isoformat()}."}}\n\n'
            ]),
            media_type='text/event-stream',
            headers={
                'X-Client-Banned-Until': ban_expiry.isoformat(),
            },
            status_code=429,
        )
    
    # Run agent (see section 9 for cascade)
    async def stream_response():
        try:
            async for event in agent.run(body.messages, body.session_id):
                yield f'data: {json.dumps(event)}\n\n'
        except Exception as e:
            yield f'event: error\ndata: {{"type": "error", "message": "{str(e)}"}}\n\n'
        finally:
            yield f'event: done\ndata: {{"type": "done"}}\n\n'
    
    return StreamingResponse(
        stream_response(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',  # Disable buffering in nginx
        },
    )
```

### Frontend Ban Handling

**File**: `src/agent/sseClient.ts`

```typescript
export class SSEClient {
  async sendMessage(msg: string): Promise<void> {
    // Check localStorage for ban
    const banUntil = localStorage.getItem('agent_ban_until');
    if (banUntil && new Date(banUntil) > new Date()) {
      throw new Error(`Rate limit ban active until ${banUntil}`);
    }
    
    const resp = await fetch('/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: this.conversationHistory,
        session_id: this.sessionId,
      }),
    });
    
    // Check for ban header
    if (resp.headers.has('X-Client-Banned-Until')) {
      const banUntil = resp.headers.get('X-Client-Banned-Until')!;
      localStorage.setItem('agent_ban_until', banUntil);
      // UI should disable input and show countdown
    }
    
    // Stream SSE events
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      
      for (const line of lines.slice(0, -1)) {
        if (line.startsWith('event:')) {
          // Parse event
          const eventData = JSON.parse(line.split('data: ')[1]);
          if (eventData.type === 'error') {
            throw new Error(eventData.message);
          }
        }
      }
      
      buffer = lines[lines.length - 1];
    }
  }
}
```

---

## 11. Powerline Status Bar Spec

Rendered as a **DOM element** directly below the CodeMirror editor, not a CM6 extension.

### DOM Structure

```html
<div id="powerline-status-bar" class="powerline">
  <!-- Left side: mode, filename, RO indicator -->
  <div class="powerline-segment left">
    <span class="mode-pill" data-mode="NORMAL">● NORMAL</span>
    <span class="powerline-sep-right">▶</span>
    <span class="filepath">www/projects/cli.md</span>
    <span class="ro-indicator">[RO]</span>
  </div>
  
  <!-- Right side: filetype, line:col, scroll % -->
  <div class="powerline-segment right">
    <span class="filetype">markdown</span>
    <span class="powerline-sep-left">◀</span>
    <span class="line-col">42:15</span>
    <span class="scroll-pct">65%</span>
  </div>
</div>
```

### CSS

```css
.powerline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  padding: 0 4px;
  background: var(--bg-main);
  border-top: 1px solid var(--tmux-green);
  font-family: JetBrains Mono, monospace;
  font-size: 11px;
  color: var(--fg-main);
}

.powerline-segment {
  display: flex;
  align-items: center;
  gap: 0;
}

/* Mode pill colors (from Gruvbox hard) */
.mode-pill {
  padding: 0 6px;
  font-weight: bold;
  border-radius: 3px;
}

.mode-pill[data-mode="NORMAL"] {
  background: #b8bb26;  /* Gruvbox green */
  color: #282828;
}

.mode-pill[data-mode="INSERT"] {
  background: #fabd2f;  /* Gruvbox yellow */
  color: #282828;
}

.mode-pill[data-mode="VISUAL"] {
  background: #83a598;  /* Gruvbox aqua */
  color: #282828;
}

/* Powerline separators: use actual glyphs */
.powerline-sep-right {
  color: var(--tmux-green);
  font-size: 13px;
  margin: 0 2px;
}

.powerline-sep-left {
  color: var(--tmux-green);
  font-size: 13px;
  margin: 0 2px;
}

.filepath {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ro-indicator {
  margin-left: 4px;
  color: #d65d0e;  /* Gruvbox orange */
  font-weight: bold;
}

.filetype {
  margin-right: 4px;
  color: #8ec07c;  /* Gruvbox green-light */
}

.line-col {
  margin: 0 4px;
}

.scroll-pct {
  margin-left: 4px;
  color: #928374;  /* Gruvbox gray */
}
```

### TypeScript Update Logic

**File**: `src/editor/statusBar.ts`

```typescript
export class PowerlineBar {
  private element: HTMLElement;
  private currentMode: 'NORMAL' | 'INSERT' | 'VISUAL' = 'NORMAL';
  
  constructor(element: HTMLElement) {
    this.element = element;
  }
  
  update(state: EditorState, currentFile: string, theme: ThemeConfig) {
    // Get mode from vim extension state (or codemirror-vim plugin)
    const vimMode = this.getVimMode(state);
    
    // Get line:col
    const selection = state.selection.main;
    const lineNum = state.doc.lineAt(selection.from).number;
    const colNum = selection.from - state.doc.lineAt(selection.from).from + 1;
    
    // Get scroll percentage
    const totalLines = state.doc.lines;
    const scrollPct = Math.round((lineNum / totalLines) * 100);
    
    // Determine file type
    const fileType = currentFile.endsWith('.md') ? 'markdown' : 'text';
    
    // Update HTML
    this.element.innerHTML = `
      <div class="powerline-segment left">
        <span class="mode-pill" data-mode="${vimMode}">● ${vimMode}</span>
        <span class="powerline-sep-right">▶</span>
        <span class="filepath">${currentFile}</span>
        <span class="ro-indicator">[RO]</span>
      </div>
      
      <div class="powerline-segment right">
        <span class="filetype">${fileType}</span>
        <span class="powerline-sep-left">◀</span>
        <span class="line-col">${lineNum}:${colNum}</span>
        <span class="scroll-pct">${scrollPct}%</span>
      </div>
    `;
  }
  
  private getVimMode(state: EditorState): string {
    // Hook into codemirror-vim's state field
    // (implementation depends on vim plugin API)
    return 'NORMAL';
  }
}
```

---

## 12. Mobile Breakpoint Spec

**Breakpoint**: < 768px viewport width

### Layout Changes

#### Desktop (≥ 768px) — No changes
- Three-panel layout unchanged
- All panels visible

#### Mobile (< 768px) — Collapse to single-view

**Default state on page load**:
- **Agent shell** (left): `display: none` (hidden)
- **File explorer** (top-right): hidden, moved to drawer
- **Vim editor**: `position: fixed; top: 0; left: 0; width: 100%; height: 100%;` — full screen
- **CLI drawer** (bottom): `display: none` (hidden)
- **Dividers**: all `display: none`

**Hamburger button**:
- Position: `position: fixed; top: 12px; right: 12px; z-index: 1001;`
- Size: 44×44px (tap target)
- Icon: `☰` (U+2630) or SVG menu icon
- Background: transparent; border: 1px solid `var(--fg-main)`
- Appears only when `is-mobile` class is active

**Mobile sidebar (file explorer)**:
- Position: `position: fixed; left: 0; top: 0; width: 280px; height: 100%; z-index: 1000;`
- Background: `var(--bg-main)`
- Border-right: 1px solid `var(--tmux-green)`
- Transform: `translateX(-100%)` (hidden by default)
- Transition: `transform 0.3s ease-out`
- When `.sidebar-open` class added: `transform: translateX(0)`

**Backdrop overlay** (behind drawer):
- `position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 999;`
- Background: `rgba(0, 0, 0, 0.5)`
- Only shown when sidebar is open
- Click to close sidebar

### CSS

```css
@media (max-width: 768px) {
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }
  
  #agent-shell {
    display: none;
  }
  
  #divider-vertical {
    display: none;
  }
  
  #divider-horizontal {
    display: none;
  }
  
  #divider-bottom {
    display: none;
  }
  
  #right-panel {
    grid-template-rows: 1fr;
  }
  
  #file-explorer {
    display: none;
  }
  
  #vim-editor-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
  }
  
  #cli-drawer {
    display: none;
  }
  
  /* Hamburger menu */
  #hamburger-menu {
    display: block;
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1001;
    width: 44px;
    height: 44px;
    padding: 8px;
    background: transparent;
    border: 1px solid var(--fg-main);
    color: var(--fg-main);
    font-size: 20px;
    cursor: pointer;
    border-radius: 4px;
  }
  
  #hamburger-menu:active {
    background: rgba(255, 255, 255, 0.1);
  }
  
  /* Mobile sidebar */
  #mobile-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: 280px;
    height: 100%;
    z-index: 1000;
    background: var(--bg-main);
    border-right: 1px solid var(--tmux-green);
    overflow-y: auto;
    transform: translateX(-100%);
    transition: transform 0.3s ease-out;
  }
  
  #mobile-sidebar.sidebar-open {
    transform: translateX(0);
  }
  
  /* Backdrop */
  #mobile-sidebar.sidebar-open::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 999;
    background: rgba(0, 0, 0, 0.5);
  }
}
```

### TypeScript Mobile Layout Logic

**File**: `src/layout/responsive.ts`

```typescript
export class MobileLayout {
  private isMobileMode = window.innerWidth < 768;
  private sidebarOpen = false;
  
  init(root: HTMLElement) {
    // Set initial class
    this.updateMobileClass(root);
    
    // Listen for resize
    window.addEventListener('resize', () => {
      this.updateMobileClass(root);
    });
    
    // Hamburger menu
    const hamburger = document.getElementById('hamburger-menu')!;
    hamburger.addEventListener('click', () => {
      this.toggleSidebar();
    });
    
    // Click item in sidebar → close sidebar
    const sidebar = document.getElementById('mobile-sidebar')!;
    sidebar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a, button')) {
        this.closeSidebar();
      }
    });
    
    // Click backdrop → close sidebar
    sidebar.addEventListener('click', (e) => {
      if (e.target === sidebar) {
        this.closeSidebar();
      }
    });
  }
  
  private updateMobileClass(root: HTMLElement) {
    const isMobile = window.innerWidth < 768;
    if (isMobile !== this.isMobileMode) {
      this.isMobileMode = isMobile;
      if (isMobile) {
        root.classList.add('is-mobile');
      } else {
        root.classList.remove('is-mobile');
        this.closeSidebar();
      }
    }
  }
  
  toggleSidebar() {
    if (this.sidebarOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  }
  
  openSidebar() {
    const sidebar = document.getElementById('mobile-sidebar')!;
    sidebar.classList.add('sidebar-open');
    this.sidebarOpen = true;
  }
  
  closeSidebar() {
    const sidebar = document.getElementById('mobile-sidebar')!;
    sidebar.classList.remove('sidebar-open');
    this.sidebarOpen = false;
  }
}
```

---

## Summary of Key Architecture Decisions

### 1. **Event Bus as Single Source of Truth**
- All cross-panel communication flows through `src/bus.ts` (owned by m4)
- No direct imports between panels; all coordination is event-based
- Makes it easy to add new panels later without refactoring existing code

### 2. **Static Manifest Baked at Build Time**
- `manifest.json` generated by Vite plugin during build
- Served as immutable asset; no runtime filesystem access on frontend
- Backend reads the same manifest at startup for search indexing
- Path validation happens on both sides; agent calls are always validated

### 3. **Model Cascade with Tool Filtering**
- OpenRouter & HuggingFace receive full tool definitions
- `src/routr` (completions proxy) **never** receives tools — text-only fallback
- Allows graceful degradation without losing core agent functionality

### 4. **xterm.js In-Browser Only**
- No server-side PTY; all three terminal instances are pure frontend
- Agent shell and CLI drawer are **JavaScript shims** that speak to the SSE backend
- Makes the site deployable on any VPS without complex shell routing

### 5. **Read-Only Markdown Viewing**
- CodeMirror is configured as read-only; insert-mode commands are no-ops
- Powerline status bar is a **DOM element**, not a CM6 extension
- Allows clean CSS styling without fighting CodeMirror's internal rendering

### 6. **Rate Limiter as In-Memory Sliding Window**
- No Redis or database; single-process VPS assumption
- Per-IP sliding window (20 req/60s) with 24h ban on breach
- Ban list resets on server restart (acceptable for this use case)

### 7. **Mobile-First Media Query Collapse**
- Desktop: three-panel layout
- Mobile: full-screen editor with hamburger-triggered file drawer
- Agent shell & CLI drawer hidden (too small to be useful)

---

## Implementation Order & Dependencies

Milestones must be executed in this order (enforced by task list dependencies):

1. **m1-scaffold**: Repo structure, Vite config, package.json, tsconfig.json (strict mode)
2. **m2-layout**: HTML shell, CSS grid, tmux dividers, mobile breakpoint
3. **m3-agent-shell**: xterm.js left panel, SSE client, MOTD, clickable links
4. **m4-vim-panel**: CodeMirror 6 + vim, NERDTree DOM, event bus, powerline bar
5. **m5-cli-drawer**: Bottom xterm.js, command interpreter, tab completion, history
6. **m6-backend**: FastAPI `/agent` SSE, LangChain agent, model cascade, rate limiter
7. **m7-routr**: Completions-only proxy (no tools, OpenAI format)
8. **m8-deploy**: systemd unit, nginx config, build script, deploy/README.md

All Workers may run in parallel **after their dependencies are complete**. The Orchestrator will manage this concurrency.

---

## Known Risks & Sharp Edges

### 1. **CodeMirror Read-Only Mode**
- Some Vim commands (e.g., `dd`, `yy`) may still mutate state even in read-only mode
- **Risk**: User confusion if they see partial functionality
- **Mitigation**: Test all common Vim commands and document in UI toast

### 2. **SSE Stream Closing on Rate Limit**
- Burst detection immediately closes the SSE stream with no graceful negotiation
- **Risk**: In-flight message loss if user triggers burst mid-message
- **Mitigation**: Frontend should not queue requests; use debounce on input

### 3. **Manifest Desync (Build vs. Runtime)**
- If user adds files to `www/` after build, they won't be searchable or navigable
- **Risk**: Confusion when agent can't find a file that exists on disk
- **Mitigation**: Document that `www/` must be final before build; consider rebuild hook on deploy

### 4. **Theme Cascade to All Panels**
- Changing theme must update all three xterm.js instances + CodeMirror + DOM tree
- **Risk**: Theme partial application if a panel fails to update
- **Mitigation**: Theme.setTheme() is synchronous; error on theme not found; test all combinations

### 5. **Model Cascade Latency**
- Trying providers in order means first failure = 5+ second delay
- **Risk**: Slow user experience on first message
- **Mitigation**: Health check providers at startup; log cascade decisions; consider timeout per provider

### 6. **In-Memory Ban List Reset on Deploy**
- If the FastAPI process restarts, all bans are cleared
- **Risk**: Abusive client could immediately re-attack after server restart
- **Mitigation**: Document this in ops guide; consider persistent ban list in future; logs IP for manual blocking

### 7. **Mobile Sidebar Overlap on Landscape Tablet**
- If user rotates device between 768px and 1024px, layout might feel cramped
- **Risk**: Poor UX on intermediate sizes
- **Mitigation**: Test tablet viewports (iPad portrait ~768px); adjust breakpoint if needed

---

## Testing Strategy (Deferred to Workers)

Each Worker milestone includes test scenarios:
- **m3**: SSE connection, MOTD rendering, clickable links
- **m4**: File loading, Vim keybindings, powerline updates, tree navigation
- **m5**: Command parsing, tab completion, history, theme switching
- **m6**: Model cascade failover, tool invocation, rate limiter triggering
- **m7**: Completions normalization, error handling
- **m2**: Mobile breakpoint, hamburger toggle, sidebar transitions

---

**End of Strategy Document**
