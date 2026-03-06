---
slug: storage
title: Storage
tags: [storage, module]
relationships:
  depends-on: [pramana, knowledge-artifact, result-type]
---

# Storage

Persistence layer with an interface/implementation split. The interface defines read/write/search contracts. The sole implementation uses `bun:sqlite` in-memory.

## Why this design

**Why an interface when there's only one implementation?**
The interface (`src/storage/interface.ts`) decouples the engine from SQLite. Tests construct SqlitePlugin directly, but the engine only knows StorageReader/StorageWriter/StorageSearcher. If a future backend (e.g., DuckDB, persistent file) is needed, only the implementation changes.

**Why FTS5 with Porter stemming?**
FTS5 is SQLite's built-in full-text search — zero external dependencies. Porter stemming handles English morphology (searching "running" finds "run"). The `unicode61` tokenizer handles non-ASCII. Alternative: Lunr.js or Tantivy — rejected because they add dependencies for marginal improvement on small corpora.

**Why WAL journal mode?**
Write-Ahead Logging allows concurrent reads during the build phase. Without WAL, the entire database locks during writes. Irrelevant for the current single-writer model but costs nothing to enable.

**Why tag filtering in application code, not SQL?**
Tags are stored as JSON arrays. SQL-level filtering would require JSON functions or a join table. For corpora under ~10K documents, filtering in TypeScript after a full scan is fast enough and simpler. This is a deliberate trade-off: simplicity over query optimization.

## Interface

Four sub-interfaces in `src/storage/interface.ts`:

- **StorageWriter**: `store(artifact)` — persist one artifact
- **StorageReader**: `get(slug)`, `list(filter?)`, `getRelationships(slug)`, `getInverse(slug)`
- **StorageSearcher**: `search(query)` — FTS5 MATCH with snippet extraction
- **StoragePlugin**: combines all three + `initialize()` and `close()`

## Schema (SQLite)

Three tables + one virtual table:

- `artifacts` — slug PK, title, tags (JSON), content, hash
- `relationships` — source, target, type, line, section (indexed both directions)
- `sections` — artifact_slug, id, heading, level, line
- `artifacts_fts` — FTS5 over slug, title, content

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| Store is transactional | Partial writes leave corrupt state | `src/storage/sqlite/index.ts:64` — `db.transaction()` | `test/unit/storage/sqlite.test.ts` > "upsert replaces existing artifact" |
| Upsert semantics on store | Re-ingesting a changed file updates, doesn't duplicate | `src/storage/sqlite/index.ts:67` — INSERT OR REPLACE | `test/unit/storage/sqlite.test.ts` > "upsert replaces existing artifact" |
| Inverse relationships include section-qualified targets | `getInverse("X")` finds edges targeting `X#section` | `src/storage/sqlite/index.ts:183` — LIKE `slug#%` | `test/unit/storage/sqlite.test.ts` > "inverse relationships" |
| Search returns ranked results with snippets | Users see context, not just slugs | `src/storage/sqlite/index.ts:197` — snippet() function | `test/unit/storage/sqlite.test.ts` > "FTS search" |

## Anti-patterns

| Don't do this | Why | Do this instead |
|---------------|-----|-----------------|
| Store tags as a join table | Over-engineering for the corpus size | Keep JSON array, filter in app code |
| Skip the transaction in store() | Partial write corrupts relationships/sections | Always wrap in `db.transaction()` |
| Use persistent SQLite path in production | Source files are truth, DB is derived | Use `:memory:` and rebuild each startup |
