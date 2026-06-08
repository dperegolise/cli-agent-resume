# About Me

I'm a senior software engineer with a decade of experience across early-stage startups and
mid-sized product companies. My work has spanned backend platform engineering, developer
experience tooling, distributed data systems, and — increasingly — building AI-adjacent
infrastructure that production teams actually trust.

I started out writing C++ for embedded devices, moved into web services during the microservices
wave, and have spent the last several years building the kind of internal platforms that let
product engineers ship without worrying about infrastructure primitives. If the work makes the
rest of the team faster, I'm interested in it.

My current focus is on the intersection of LLM tooling and developer workflows: agents that
operate over code and structured data, fast evaluation pipelines, and the glue between model
providers and production systems. I'm skeptical of hype but convinced that the right
abstractions here will matter a great deal.

---

## Tech philosophy

- **Boring technology wins.** Pick the proven tool, then optimize only the parts that actually
  bottleneck you. Postgres before Cassandra. HTTP before gRPC. Single process before a cluster.
- **Observability is not optional.** If I can't tell why something is slow or broken, I haven't
  finished building it. Structured logs, traces, and metrics are part of the deliverable.
- **Interfaces outlast implementations.** I spend more time on API and data-contract design than
  most. A clean interface absorbed by many callers is the hardest thing to change.
- **Read-only is a feature.** The best systems minimize writable surface area. Immutable
  artifacts, idempotent operations, append-only logs.

---

## Stack I reach for

**Languages**: Python, TypeScript/JavaScript, Go (day-to-day); Rust (hobby/infra tooling);
SQL (always)

**Infra**: Linux, systemd, nginx, Docker, occasional k8s; VPS-first when it fits

**Data**: PostgreSQL, Redis, SQLite; BM25 / vector search when warranted

**Frontend**: Vanilla TS + Vite when I can; React when the team already has it
