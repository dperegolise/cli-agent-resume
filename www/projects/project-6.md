# claude-sysadmin

Claude-assisted administration of a remote Linux VPS under a strict observability + audit
+ server-enforced contract. Every command the agent runs is watched live, archived to a
git audit trail, and gated by a server-side whitelist it cannot bypass.

**Source**: private repo — happy to walk through it.

---

## What it is

A pattern (and the scripts that implement it) for letting an AI agent administer a real
server without trusting it:

- **Live observability**: every command Claude runs on the box appears in a shared remote
  tmux session the human can watch in real time.
- **Total audit**: every command — the command string, captured output, and the agent's
  stated rationale — is committed to a git audit repo on the VPS. One command = one
  commit, so the admin history is diffable, blameable, and tamper-evident.
- **Three-layer enforcement**: client-side settings deny raw `ssh`/`scp`; a `claude-run`
  wrapper is the only permitted path; and a server-side gate bound to a dedicated
  restricted SSH key rejects anything outside a tiny whitelist of verbs. The agent
  physically cannot open an unrestricted shell.

The agent reads command output from per-command logfiles rather than scraping the tmux
pane, so what it reasons about is exactly what was captured for the audit.

---

## Why I built it

I wanted Claude doing real ops work on a real VPS — nginx configs, certificate renewals,
service debugging — but "give the agent root and hope" is not a security posture.
The insight is that the interesting controls are *server-side*: client configuration is
advisory (the agent could be confused or prompted into ignoring it), but a forced command
on a restricted SSH key is physics. The client-side denials exist for ergonomics; the gate
exists for safety.

It's host-agnostic by design — nothing about the site layout or services is baked in; the
agent discovers the box at use-time like any new sysadmin would.

---

## Technical decisions worth noting

**Git as the audit log**: free integrity, free tooling, free retention. `git log` over the
audit repo answers "what did the agent do last Tuesday and why" with no custom
infrastructure.

**tmux send-keys as the execution path**: commands run in a pane the human can attach to,
which turns oversight from "review the logs later" into "watch it happen."

**Separate keys, separate trust**: the human's unrestricted SSH alias and the agent's
restricted one are different keys with different server-side treatment. The agent's key
forces the gate; no flag on the client can undo that.

---

## Stack

Bash, SSH forced commands, tmux, git, Claude Code permission settings (deny rules + a
single wrapped entrypoint)
