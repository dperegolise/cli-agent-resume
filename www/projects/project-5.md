# tessra-sheets

An AI-integrated collaborative spreadsheet: a Univer-powered grid with a 150-function
formula engine, real persistence, auth and permissions, and AI woven in as both a sidebar
(NL-to-formula) and a cell function (`=AI()`).

**Source**: private repo — happy to walk through it.

---

## What it is

A working spreadsheet application, currently through its MVP phase:

- **Grid + formulas**: Univer grid frontend over a custom formula engine implementing 150
  spreadsheet functions, with undo/redo.
- **Persistence**: Postgres for structured data, S3-compatible object store for sheet
  blobs.
- **Multi-tenancy**: auth, permissions, and an organization/workspace model.
- **AI layer**: a provider abstraction spanning OpenAI, Anthropic, Google, and Hugging
  Face; natural-language-to-formula generation; and `=AI()` as a first-class cell function
  so model output lands *in the grid* like any other computed value.

It's a pnpm/Turbo monorepo — Next.js web app, Hono API server, and shared packages for
the sheet core, AI providers, and evals — with strict TypeScript across all nine packages,
Biome, Vitest, and Playwright smoke tests.

---

## Why I built it

Spreadsheets are the world's most successful end-user programming environment, and
"AI + spreadsheet" is mostly being done as a chatbot bolted to the side. I wanted to find
out what it takes to make AI a *native primitive* of the grid — where `=AI("classify",
A2)` recalculates like `=SUM()` does — and that forces you to solve the real problems:
dependency tracking through nondeterministic cells, caching and cost control, provider
failover, and prompt construction from 2-D context.

It's also the largest exercise of disciplined monorepo TypeScript I've done solo: nine
packages, strict mode everywhere, an eval harness for the AI features alongside the unit
tests.

---

## Technical decisions worth noting

**Univer for the grid, custom engine for formulas**: rendering a spreadsheet is a solved
problem; owning the formula engine is what makes `=AI()` and NL-to-formula possible
without fighting someone else's evaluation model.

**Provider abstraction from day one**: every AI feature goes through one interface with
four backends. Model churn is constant; the abstraction is what survives.

**Evals as a package**: AI features get a dedicated eval suite in the workspace, run like
tests. "The formula generator seems better" is not a measurement.

---

## Stack

TypeScript (strict), Next.js, Hono, Univer, Postgres, S3-compatible object storage, pnpm
workspaces, Turbo, Biome, Vitest, Playwright
