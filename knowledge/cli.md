---
slug: cli
title: CLI
tags: [cli, module]
relationships:
  depends-on: [pramana, engine, api]
---

# CLI

Entry point and command dispatcher. Every command follows the same lifecycle: initialize storage → build → query.

## Why this design

**Why rebuild on every invocation?**
No persistent state means no stale data. The CLI is a pipeline: `source dir → parse → index → query → output`. Each run is hermetic. The cost (~100ms for hundreds of files) is acceptable for interactive use.

**Why JSON output to stdout, diagnostics to stderr?**
Unix convention. Stdout is for machine-readable data (pipe to `jq`, consume from scripts). Stderr is for human-readable status (ingestion summary, errors). This makes `pramana list --source kb | jq '.[] | .slug'` work correctly.

## Commands

| Command | Maps to | Output |
|---------|---------|--------|
| `serve --source <dir>` | `createServer({reader})` | HTTP server |
| `get <slug> --source <dir>` | `reader.get(slug)` | JSON to stdout |
| `search <query> --source <dir>` | `reader.search(query)` | JSON to stdout |
| `traverse <slug> --source <dir>` | `reader.traverse(slug, type?, depth?)` | JSON to stdout |
| `list --source <dir>` | `reader.list(filter?)` | JSON to stdout |

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| Ingestion summary goes to stderr | Doesn't pollute JSON output | `src/cli/index.ts:44` — `console.error` | `test/e2e/full-pipeline.test.ts` — tests query stdout, not stderr |
| Missing --source exits with error | Required for all commands | `src/cli/index.ts:63-66` | **[GAP]** — no dedicated test |
| Non-zero exit on error | Scripts can check `$?` | `src/cli/index.ts:65` — `process.exit(1)` | **[GAP]** — no dedicated test |
