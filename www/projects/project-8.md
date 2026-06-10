# ovtr

An agentic software-development and project-management system for the solo operator
running many client projects on one machine. You compose work as flow-graphs;
scope-bounded agents execute in isolated git worktrees; a unified memory fabric remembers
your whole portfolio — with hard confidentiality walls between clients.

**Source**: private for now

---

## What it is

The agent-tooling landscape splits into amnesiac single-session assistants and
heavyweight multi-agent cloud platforms built for organizations. ovtr is built for the gap
between them — one developer, many clients, one machine:

- **The fabric**: one Postgres store for everything the system *knows* — a containment
  tree (Operator → Client → Suite → Project → Repo → Module), skills, agent definitions,
  ingested documents, and a temporal knowledge graph that tracks how things change.
- **Flow-graphs**: the agent lifecycle (provision worktree → run worker → open PR → tear
  down) is decomposed into composable nodes, so standard tasks wire up in one move and
  non-standard flows are just different wiring.
- **Scope-bounded agents**: every agent runs with an explicit read/write scope in its own
  worktree; its changes arrive as reviewable pull requests. Two execution backends — a
  direct model API or a driven Claude Code session — behind one uniform loop.
- **The director**: a persistent, self-curating assistant with tiered memory that
  consolidates, promotes, and *retracts* beliefs rather than just accumulating them.
- **A confidence gate**: a deterministic function — not a prompt — decides whether an
  action runs autonomously, is proposed for review, or escalates. Anything that modifies
  the system's own behavior routes to review by construction.

---

## Why I built it

I'm the operator it describes: many clients and projects on one box, needing durable
memory that respects client boundaries. Existing tools made me choose between an assistant
that forgets everything at session end and a platform that wants to be autonomous. ovtr's
core bet is that for a solo operator, **autonomy is earned, not assumed** — build the
rails (locks, gates, review tiers) first, and turn on the engine deliberately once the
user-driven system has proven itself.

The hardest design problem was scoping: client confidentiality is enforced in the
authorization code path, not by convention, so one client's knowledge can never reach
another's agents regardless of how a graph is wired.

---

## Technical decisions worth noting

**Behavior lives in one of three places, chosen by a clear test**: run it identically
every time → an orchestrator graph; let the model adapt it → a skill; it's a hot path or
safety-critical → code. Graphs may load skills; skills may *recommend* graphs but can
never author or fire one — learned writes never reach deterministic execution.

**Knowledge in a database, not scattered markdown**: skills, guidance, and memory are
versioned, queryable, scope-inherited records in the fabric. Markdown is an interchange
format, not the store — which is what makes knowledge shareable across projects and
retrievable semantically.

**Honest measurement as a safety property**: a task that ran but produced nothing is never
recorded as a success. A corrupted record of "what worked" poisons everything a learning
system does downstream.

**Borrow patterns, not frameworks**: every subsystem traces to a known frontier pattern,
deliberately re-implemented to fit a single-machine, single-operator, multi-client world.

---

## Stack

Postgres (memory fabric + temporal knowledge graph + operational schemas), Python,
TypeScript/React shell, git worktrees, MCP, its own model router (see routr)
