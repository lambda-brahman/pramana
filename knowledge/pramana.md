---
slug: pramana
title: Pramana
tags: [engine, module]
relationships:
  depends-on: [knowledge-artifact, parser, storage, engine, api, cli, result-type, programming-model]
---

# Pramana

A knowledge engine. Markdown files → queryable knowledge graph.

## Architecture

```
Source Dir (*.md)
      │
      ▼
  ┌─────────┐     ┌───────────┐     ┌──────────────┐
  │ Parser   │────▶│ Builder   │────▶│ StoragePlugin │
  │ string→  │     │ dir→store │     │ (in-memory)   │
  │ Artifact │     │ each file │     └──────┬────────┘
  └─────────┘     └───────────┘            │
                                    ┌──────┴────────┐
                                    │    Reader      │
                                    │ get/search/    │
                                    │ traverse/list  │
                                    └──────┬────────┘
                                     ┌─────┴─────┐
                                     │           │
                                  ┌──▼──┐   ┌───▼──┐
                                  │ API │   │ CLI  │
                                  │HTTP │   │stdout│
                                  └─────┘   └──────┘
```

## Composition

| Component | Role | Interface |
|-----------|------|-----------|
| [[knowledge-artifact]] | Core type — the element | Zod schema + TypeScript type |
| [[result-type]] | Error handling — the wrapper | `Result<T, E> = Ok(T) \| Err(E)` |
| [[parser]] | Write path — string → Artifact | `parseDocument : string → Result<Artifact, Error>` |
| [[storage]] | Persistence — store + query | `StoragePlugin = Writer ∧ Reader ∧ Searcher` |
| [[engine]] | Orchestration — build + read | `Builder.build`, `Reader.{get,search,traverse,list}` |
| [[api]] | HTTP surface | `Route → Reader op → JSON Response` |
| [[cli]] | CLI surface | `Command → lifecycle → JSON stdout` |
| [[programming-model]] | Abstract machine | Types, interfaces, 14 laws, plugin contract |

## Invariants

**I1. Source files are truth**: the database is derived, ephemeral, rebuilt every startup. No persistent storage.

**I2. Read-only after build**: once the Builder completes, no writes occur. The Reader is purely a query layer.

**I3. Total error handling**: every fallible operation returns Result. No thrown exceptions anywhere in the pipeline.

**I4. Two relationship types**: `depends-on` and `relates-to`. Enforced by Zod enum at parse time.

## Runtime

Bun. Chosen for: `bun:sqlite` (zero-dep SQLite), `Bun.serve()` (zero-dep HTTP), `bun build --compile` (standalone binaries), `Bun.file` (file IO), `Bun.CryptoHasher` (SHA-256), `Bun.Glob` (file scanning).

## Design rationale

**Why in-memory, not persistent?** Eliminates sync, migration, and stale-state problems. Source files are always authoritative.

**Why four primitives?** get (point lookup), search (discovery), traverse (graph walk), list (enumeration). Minimal complete set — they compose to answer any question. See [[programming-model]] query patterns.

**Why typed relationships enforced at parse time?** Untyped or ad-hoc relationship types can't be queried. If `traverse --type X` is meaningful, X must be a known type.
