# claude-teamwork

A self-contained Claude Code plugin that runs an autonomous, role-specialized engineering
team — Supervisor, Orchestrator, Explorer, Workers, Reviewer, Critic, Auditor, Integrator —
a port of Google Antigravity's "build-an-OS" agent architecture onto Claude Code's native
Agent Teams primitives. No external services, no databases.

**GitHub**: https://github.com/dperegolise/claude-teamwork

---

## What it is

You hand it an objective; it structures the intent, decomposes the work into milestones on
a shared task list, and dispatches specialist teammates that message each other directly.
Each role has exactly one job:

- **Supervisor** (the lead) structures intent, pre-creates git worktrees, and never writes
  code.
- **Orchestrator** plans milestones and owns the concurrency plan.
- **Workers** are the only role that writes product code — each in an isolated worktree on
  its own branch, so independent milestones run as parallel Workers safely.
- **Reviewer** judges design correctness; **Critic** attacks the result with adversarial
  tests; **Auditor** does a static-analysis authenticity check; **Integrator** merges
  reviewed + audited branches back to the base branch.

Coordination runs entirely on native Agent Teams mechanisms (`SendMessage`, the shared
task list, automatic idle-notify). The filesystem holds only durable evidence and the
resume substrate.

---

## Why I built it

Google's Antigravity demoed a role-specialized agent team building an OS; I wanted that
architecture on infrastructure I already live in, with nothing but Claude Code itself —
no external services, no orchestration server.

Single-agent coding sessions also hit two walls: context exhaustion on long tasks, and
the agent grading its own homework. This plugin attacks both. A `PreCompact` hook
distills the full transcript into a structured handoff file (via a headless Haiku pass)
before compaction, and a post-compact hook points the session back at it — so the run's
real state survives every context-window squeeze. And completion is physically gated: a
`Stop` hook blocks the run from finishing until an independent Auditor writes an
`audit-PASS` marker, so "the tests pass" has to survive a teammate whose only job is to
catch hardcoded outputs and mock facades.

---

## Technical decisions worth noting

**Worktree isolation is what buys parallelism**: the lead creates
`.claude/worktrees/<id>` on branch `<id>`, `cd`s into it, and spawns the Worker from there
— a teammate inherits the lead's cwd at spawn time, so it starts inside the worktree with
no extra ceremony. Disjoint milestones become concurrent Workers on disjoint branches.

**Crash-resumable by design**: a `SessionStart` hook detects an in-progress run; a fresh
Supervisor rehydrates from the on-disk run state, handoff JSON, and the worktree branches.
The team is session-bound but the run is not. (This site was built by it — the run
survived nine compaction-driven handoffs across multiple sessions.)

**Succession is layered, hooks before promises**: the protocol also lets a long-lived
teammate *ask* to be replaced from its own handoff (`RECYCLE_ME`), but that depends on the
model noticing its context limit — so the load-bearing mechanism is the hook, which fires
deterministically on every compaction whether or not the agent is paying attention.

**The audit gate is the one filesystem signal**: everything else moved to native
messaging, but the anti-cheating marker stays on disk precisely because it must survive a
crash and a fresh lead.

---

## Stack

Claude Code plugin system (commands, agents, hooks), Agent Teams, Node.js hook scripts
(plain `.mjs`, zero dependencies), git worktrees
