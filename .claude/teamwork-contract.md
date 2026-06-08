# teamwork — coordination contract

This file is the shared brain for the `teamwork` agent team. The Supervisor (lead) and every
teammate must follow it. Teammates load the project's `CLAUDE.md` on spawn (not the lead's
conversation), so this contract — not chat history — is how they stay aligned. Install it by
running `/teamwork:install` from your project root (copies this file to `.claude/teamwork-contract.md`
and imports it from `.claude/CLAUDE.md`, leaving your root `CLAUDE.md` untouched), or do it manually
by copying this content into your project's `.claude/CLAUDE.md` or importing it with
`@teamwork-contract.md` from there.

## Coordination uses native Agent Teams primitives
This plugin coordinates through the **built-in** Agent Teams mechanisms, not a custom filesystem
mailbox:
- **Messaging:** `SendMessage` to a teammate (or the lead) by name. Delivery is automatic — the
  recipient does not poll. Any teammate can message any other by name; teammates can message the
  lead (child→parent and peer→peer are both supported, not just lead→teammate).
  NOTE: the Agent Teams docs say `SendMessage` and the task tools are "always available to a
  teammate even when `tools` restricts other tools," but in practice a teammate spawned from an
  agent definition with a `tools:` allowlist is denied SendMessage ("not enabled in this context")
  unless the tool is listed. So every teammate agent (`agents/*.md`) **explicitly lists**
  `SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet` in its `tools:` — do not remove them.
- **Shared task list:** `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`. This is the single
  source of truth for milestone progress (pending → in_progress → completed), including
  dependencies — a task with unresolved deps cannot be claimed until they complete. Do NOT keep a
  parallel `board.json`; the task list replaces it.
- **Idle notifications:** when a teammate finishes its turn and goes idle, the lead is notified
  automatically. The lead does not need to watch heartbeats to learn a teammate stopped.

The only thing the filesystem owns is the **durable audit gate and the report artifacts** (below),
which must survive a crash and a fresh lead. Coordination signals go over the mailbox/task list;
durable evidence goes to `.teamwork/`.

## Roles
- **Supervisor** (the lead session; also the *Sentinel*): structures intent, creates the team and
  spawns teammates (teammates cannot spawn teammates), **pre-creates git worktrees** for code roles,
  enforces the audit gate, owns resume. Writes no product code (it may run `git worktree` / merge
  plumbing as coordination — see Worktrees).
- **Orchestrator** (teammate): decomposes the objective into tasks on the shared task list,
  requests specialists from the Supervisor, coordinates, synthesizes. No code. Self-succeeds at its
  context limit.
- **Explorer** (teammate): writes technical strategies. No code.
- **Worker** (teammate): the only role that writes product code. Works inside a pre-created worktree.
- **Reviewer** (teammate): design-correctness review. Read-only on code.
- **Critic** (teammate): adversarial testing. Tests only, inside a pre-created worktree.
- **Auditor** (teammate): static-analysis authenticity check. Read-only. Produces `audit-PASS`.
- **Integrator** (teammate): merges reviewed + audited milestone branches back into the base branch,
  resolves conflicts, re-runs tests post-merge. The only role that touches the base branch.

## Worktrees (isolation for code roles)
Teammates do NOT get automatic worktree isolation from frontmatter — `isolation: worktree` only
applies to Task subagents, not Agent Teams teammates. And a teammate cannot reliably switch into a
worktree itself (`EnterWorktree` from a teammate is unreliable). BUT a spawned teammate **inherits
the Supervisor's current working directory at spawn time** (verified). So the Supervisor creates the
worktree, `cd`s into it, and spawns the code role from there — the teammate starts already inside
the worktree, no EnterWorktree needed:

1. **Supervisor** (when dispatching a Worker/Critic for milestone `<id>`), via Bash, together:
   ```
   git worktree add .claude/worktrees/<id> -b <id>   # create (reuse: drop -b if branch exists)
   cd .claude/worktrees/<id>                          # worktree becomes the Supervisor's cwd
   ```
   The worktree is under the project root, so this `cd` persists across the Supervisor's Bash calls.
   Ensure `.claude/worktrees/` is gitignored. Then immediately spawn the Worker/Critic (step 2), then
   `cd` back to the repo root. Don't spawn a second code role between the `cd` and the spawn.
2. **Worker/Critic** start with their **cwd already set to the worktree** (`.claude/worktrees/<id>`,
   branch `<id>`). They just Write/Edit/Bash normally — files land in the worktree, commits go to
   branch `<id>`. They must NOT commit to the base branch. Report the branch name (`<id>`) when done.
3. **Integrator** merges branch `<id>` into the base branch (see its role) only after the milestone
   passes review and the run passes audit.
4. **Supervisor** removes finished worktrees (`git worktree remove .claude/worktrees/<id>`) during
   cleanup.

**Setup is serial; execution is parallel.** Because the worktree-create / `cd` / spawn / `cd`-back
dance shares the Supervisor's single cwd, the Supervisor sets up and spawns code roles **one at a
time** (hence "Don't spawn a second code role between the `cd` and the spawn"). But once spawned,
those Workers **run concurrently** — the Orchestrator deliberately fans out independent milestones
(no shared deps, disjoint files) into parallel Workers, each isolated in its own worktree/branch,
and sequences dependent ones via task `deps`. So the per-milestone worktree is not just isolation
for its own sake; it is what makes parallel Workers safe. The Supervisor does not decide what runs
in parallel — it serializes spawning and the Orchestrator owns the concurrency plan.

The actual code lives in the project / its worktrees, never inside `.teamwork/`.

## Workspace layout (`.teamwork/` — durable artifacts + resume state, NOT the codebase)
```
intent/objective.md          the structured goal
state/run-state.json         the durable run state (source of truth for resume)
strategy/strategy-<id>.md    Explorer output
reports/<id>.md              Worker reports (include the branch name)
reports/review-<id>.md       Reviewer verdicts
reports/critic-<id>.md       Critic findings
reports/integrate-<id>.md    Integrator merge reports
reports/audit-<n>.md         Auditor verdicts
reports/audit-PASS           marker file; its existence is the completion gate
reports/final-summary.md     Supervisor's closing summary
handoff/latest.json          most recent succession handoff
handoff/orchestrator-<n>.json  succession history
heartbeats/<session_id>      liveness stamps (written automatically by a hook)
logs/events-*.jsonl          structured event log (written automatically by hooks)
```
Milestone *progress* lives in the native task list (`TaskList`), not a file. The `.teamwork/`
reports are durable *evidence* (what was built, reviewed, found, audited), referenced from tasks.

## Message protocol (native SendMessage — concise, structured payloads)
Teammates request help from the **Supervisor** (only the lead can spawn):
- `SPAWN_REQUEST role=<role> task="<what's needed>" [handoff=<path>]`
  → Supervisor replies `SPAWN_OK role=<role> name=<teammate-name>`; message that teammate directly.
- `RECYCLE_ME handoff=<path>` — "near my context limit; replace me from this handoff."
- `BLOCKED task=<id> reason="..."` — escalate a blocker.

Status messages (SendMessage to the Orchestrator, or whoever dispatched you):
`STRATEGY_READY`, `MILESTONE_DONE task=<id> branch=<id> report=<path>`, `REVIEW_DONE`,
`CRITIC_DONE`, `INTEGRATE_DONE task=<id>`, `AUDIT_DONE`. Orchestrator → Supervisor when finished:
`RUN_COMPLETE summary="..."`. Always also reflect the state change in the task list
(`TaskUpdate`), since that is what other teammates and the lead read.

Orchestrator → Integrator (the merge plan — the Integrator does not discover branches itself):
`INTEGRATE branches=[<id>, <id>, ...] order=deps` — the explicit, dependency-ordered list of
milestone branches to merge into the base branch. Workers can run in parallel across multiple
worktrees/branches, so the Orchestrator tracks every branch it created and hands the full set (and
any later additions) to the Integrator.

## Handoff schema (`handoff/latest.json`)
```json
{
  "succession_index": 0,
  "objective": "one-line restatement",
  "milestones": [{"id":"","title":"","status":"pending|in_progress|done|blocked","owner":"","branch":""}],
  "completed": ["<ids>"],
  "pending_decisions": [{"q":"","context":"","options":[]}],
  "dispatched_teammates": [{"role":"","task":"","report":""}],
  "open_questions": [],
  "next_action": "explicit first instruction for the successor"
}
```

## RESUME PROTOCOL (durability — how a fresh Supervisor recovers a crashed run)
The team is session-bound: if the lead's process dies, the team dies, but the run survives on disk.
A `SessionStart` hook auto-detects an in-progress run and injects a reminder. Note the native task
list and in-process teammates do NOT survive a lead restart — so the durable substrate is
`.teamwork/` (run-state, handoff, reports) plus the worktree branches on disk. When you (a fresh
Supervisor) start and a run is in progress, do this **before anything else**:

1. **Detect.** Read `state/run-state.json`. If `status` is not `complete`/`failed`, a run is live.
2. **Reconstruct.** Read `handoff/latest.json` (latest distilled state, including per-milestone
   branch names). Skim the newest `reports/` and the tail of today's `logs/events-*.jsonl`, and
   `git worktree list` / `git branch` to see which milestone branches exist and how far each got.
3. **Announce.** Tell the user what was happening, which milestones are done vs pending, and that
   you are resuming (not restarting).
4. **Re-spawn.** Create a fresh team and spawn one `orchestrator` teammate seeded with
   `handoff/latest.json` (and the objective). It rebuilds the task list from the handoff and
   continues from `next_action`. Do not recreate worktrees/branches that already exist.
5. **Continue.** Resume normal coordination (§ "Run the team" in the `/teamwork:start` command).
   Re-spawn specialists on request as before. Do NOT redo completed milestones.

Never start a fresh run over an in-progress one unless the user explicitly says so.
