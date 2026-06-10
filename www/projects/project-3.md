# devservr

Bare-metal service orchestration for developers and AI agents: declarative multi-service
orchestration with port isolation, health monitoring, and dependency ordering — without
containers.

**GitHub**: https://github.com/dperegolise/devservr

---

## What it is

Docker Compose assumes containers. PM2 and foreman don't manage ports. Devcontainers
provision environments but don't orchestrate the services inside them. devservr fills the
gap on a bare-metal dev box:

- **Groups and servers** — declare servers with start scripts, lifecycle hooks, env vars,
  and health checks; organize them into groups with dedicated port ranges.
- **Port management** — automatic allocation within group ranges, conflict detection via
  socket probe.
- **Dependency ordering** — DAG-based topological sort for group start; respects
  `depends_on`, detects cycles.
- **Health monitoring** — background polling of endpoints or healthcheck scripts; PM2
  process status (online/stopped/errored) tracked separately from application health.
- **Declarative apply** — define everything in YAML/JSON and apply in one idempotent call.
- **MCP integration** — every REST endpoint is automatically an MCP tool, so AI agents get
  typed, observable control over the dev environment instead of blind shell commands.

---

## Why I built it

I run a lot of services on one machine — APIs, frontends, daemons, agent backends — and
increasingly it's AI agents starting and stopping them. An agent managing services through
raw shell commands can't tell what's running, which port is free, or whether a restart
actually worked. Giving agents a typed orchestration API (for free, via MCP) turns "run
the dev script and hope" into observable, idempotent operations.

It's deliberately headless and deliberately not a process supervisor: PM2 owns process
lifecycle; devservr is the orchestration layer above it.

---

## Technical decisions worth noting

**FastAPI-MCP for zero-config tooling**: every endpoint becomes an MCP tool with no
duplicated schema definitions. The API *is* the agent interface.

**JSON file store, not a database**: persistence is a single file at
`~/.devservr/devservr.json`. Local-dev tool, local-dev posture — no auth, no multi-host,
no container runtime, on purpose.

**Two-axis status**: "PM2 says the process is online" and "the health check passes" are
different facts, tracked and reported separately. Conflating them is how orchestrators lie
to you.

---

## Stack

Python 3.12+, FastAPI, FastAPI-MCP, PM2, graphlib, pytest
