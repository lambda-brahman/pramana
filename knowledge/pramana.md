---
slug: pramana
title: Pramana
tags: [engine, module]
relationships:
  depends-on: [knowledge-artifact, parser, storage, engine, api, cli, result-type, programming-model]
---

# Pramana

A knowledge engine that turns Markdown files into a queryable knowledge graph.

## Why this exists

Most knowledge tools optimize for writing (wikis) or reading (search engines). Pramana optimizes for **querying relationships** — answering "what depends on X?" or "what does Y need?" without reading prose. The insight: knowledge becomes computable when relationships are typed and directional.

## Design rationale

**Why Markdown with frontmatter, not a database or custom format?**
Authors already think in Markdown. Frontmatter adds just enough structure (slug, tags, typed relationships) without breaking the authoring flow. The alternative — a schema-first approach — was rejected because it forces authors to think like database designers.

**Why in-memory SQLite, not persistent storage?**
Source files are the truth. The database is a derived index rebuilt on every startup. This eliminates sync problems, schema migrations, and stale state. The trade-off: startup cost scales with corpus size. Acceptable for knowledge bases under ~10K documents.

**Why four read-only primitives (get, search, traverse, list)?**
These are the minimal complete set for knowledge graph queries. `get` retrieves, `search` discovers, `traverse` follows edges, `list` filters sets. Adding more (e.g., aggregate, diff) was considered premature — these four compose to answer any question via [[programming-model]].

**Why Bun, not Node.js?**
`bun:sqlite` provides zero-dependency SQLite. `Bun.serve()` provides zero-dependency HTTP. `bun build --compile` produces standalone binaries. No native addon compilation, no node_modules in production.

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| All data is read-only after build | Eliminates race conditions and cache invalidation | `src/engine/reader.ts` — no write methods | `test/e2e/full-pipeline.test.ts` — query tests run after build |
| Every operation returns Result, never throws | Callers must handle errors explicitly | `src/lib/result.ts` | `test/unit/parser/document.test.ts` — error cases return Err |
| Source files are the single source of truth | DB is ephemeral, rebuilt every startup | `src/cli/index.ts:29` — `:memory:` | `test/e2e/full-pipeline.test.ts` — builds from fixtures each run |

## Anti-patterns

| Don't do this | Why | Do this instead |
|---------------|-----|-----------------|
| Persist the SQLite database | Creates sync problems with source files | Always use `:memory:` and rebuild |
| Throw exceptions in parsers/storage | Breaks the Result contract, callers won't catch | Return `err()` with a typed error |
| Add write endpoints to the API | Violates read-only invariant, source files are truth | Edit source files directly |
