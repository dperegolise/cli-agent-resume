# Staff Engineer, Inference Platform — Helix AI

**2023–present** | Remote

Helix AI builds infrastructure for enterprises deploying large language models in regulated
industries (finance, healthcare, legal). My role sits at the intersection of model serving
infrastructure and the developer platform used by internal ML engineers and external integrators.

---

## Responsibilities

**Inference serving**: Own the inference stack — a multi-tenant service that routes requests
to a fleet of GPU instances across three cloud providers, with latency-aware load balancing,
per-tenant rate limiting, and hardware-aware model placement. Built on top of vLLM with a
custom routing layer in Go.

**Model cascade & fallback**: Designed and shipped a provider cascade system that fails over
between hosted model APIs (OpenAI, Anthropic, Cohere) and self-hosted inference endpoints based
on availability, cost, and capability requirements. This reduced P99 latency spikes from
provider outages by ~80% for enterprise SLA customers.

**Evaluation infrastructure**: Designed an offline eval pipeline for regression testing model
changes — structured prompts, deterministic comparison, LLM-as-judge scoring, and automatic
pass/fail gating in CI. Reduced the time to evaluate a model change from 2 days (manual) to
90 minutes (automated).

**Developer platform**: Built internal tooling for ML engineers: dataset management APIs,
experiment tracking integrations, reproducible prompt templating, and a CLI for the model
registry.

---

## Impact

- Reduced median inference latency by 35% through batching policy improvements and
  connection pool tuning
- Scaled the inference platform from 3 enterprise customers to 47 without adding headcount
  to the infra team
- Shipped the evaluation framework that enabled the company's SOC 2 Type II certification
  (eval records as auditable artifacts)
- Mentored 3 senior engineers on distributed systems design and production readiness practices

---

## Stack

Go, Python, Kubernetes, vLLM, PostgreSQL, Redis, Prometheus, Grafana, Temporal (workflows)
