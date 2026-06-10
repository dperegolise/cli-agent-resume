# routr

A single-binary Go daemon that routes prompts through a cascade of nine AI providers,
streams responses over SSE, manages live CLI-agent terminal sessions in tmux, and ships
its own React playground embedded in the binary. It's the model router behind ovtr, and
the fallback backend for the agent on this site.

**GitHub**: https://github.com/dperegolise/routr

---

## What it is

One daemon (`provrtr`) that unifies every way of talking to a model:

- **Multi-provider routing**: a single `POST /api/completions/stream` fans out across 3
  CLI wrappers (Claude Code, Codex, Gemini) and 6 HTTP APIs (OpenAI, Google, OpenRouter,
  Groq, Hugging Face, Ollama). A "cascade" sends the prompt down a ranked provider list
  and returns the first success.
- **Managed terminal sessions**: the `claude_cli` provider launches Claude Code inside a
  tmux session, detects idle/processing state from scrollback, and extracts structured
  conversations. Sessions survive daemon restarts; the daemon reconciles on startup.
- **Inter-agent messaging**: a Postgres-backed inbox delivers messages between terminals
  and API sessions when the receiver goes idle, retried by a watchdog.
- **Activity logging + search**: every completion emits events persisted to Postgres and
  broadcast over SSE; tsvector + GIN full-text search across all agent activity.
- **Tool sandbox**: built-in tools (think, files, search, shell) run in a sandboxed
  directory with denylist and symlink checks; MCP bridge tools merge into the same list.
- **The rest**: an MCP server endpoint, a WebSocket bridge to any managed terminal's PTY,
  an OpenAI-compatible proxy, and an embedded React playground via `//go:embed`.

---

## Why I built it

Running many agents on one machine means many model backends: paid APIs, free tiers,
local Ollama, and CLI subscriptions that are effectively prepaid compute. I wanted one
endpoint where the *caller* stops caring which backend answers: cascade through the cheap
and local options first, fall back to paid APIs, and treat a Claude Code session in tmux
as just another provider. That last idea, terminal sessions as fully routable
providers with state detection and conversation extraction, is the unusual part, and it
turns a CLI subscription into programmable infrastructure.

It started as the completions proxy for this portfolio's agent and grew into ovtr's
model-access layer.

---

## Technical decisions worth noting

**Single binary, embedded UI**: Go + `//go:embed` means deploy-by-copy. The playground,
the API, the MCP server, and the terminal manager are one artifact.

**Ephemeral conversations, durable operations**: conversation history is deliberately not
persisted server-side (the playground keeps its own in `localStorage`); sessions,
terminals, inbox messages, and activity events live in Postgres. State that must survive a
restart does; state that shouldn't accumulate doesn't.

**Idle detection from scrollback**: knowing when a CLI agent is *done* is the hard problem
in driving terminals programmatically. The watchdog polls captured pane content for
provider-specific idle signatures, which is also what gates inbox delivery.

**Local-first trust posture**: no auth, binds localhost by default, trusted-LAN by
explicit choice. It's infrastructure for one operator's machine, stated plainly rather
than half-secured.

---

## Stack

Go 1.25, Postgres (goose migrations, tsvector search), tmux, SSE, WebSockets, MCP,
React 18 + Vite 5 (embedded via `go:embed`)
