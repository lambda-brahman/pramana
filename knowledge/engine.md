---
slug: engine
title: Engine
tags: [engine, module]
relationships:
  depends-on: [pramana, parser, storage, result-type]
---

# Engine

Two components: the Builder (write path) and the Reader (read path). Wired together in the CLI at startup.

## Why builder/reader split

The build phase is sequential and fallible (files may be malformed). The read phase is concurrent and infallible against the stored data. Separating them means the reader never encounters parse errors — it only sees validated artifacts. This is a CQRS-like separation (see established literature) applied to a knowledge engine rather than a database.

## Builder

`src/engine/builder.ts` — Scans `**/*.md` via Bun.Glob, parses each file, stores successful artifacts, collects failures into a BuildReport.

**Why continue on failure?**
A single malformed file shouldn't prevent querying the rest of the corpus. The BuildReport surfaces failures to the user via stderr while the valid artifacts remain queryable.

## Reader

`src/engine/reader.ts` — Four query primitives wrapping storage calls.

**Why compute inverse relationships at query time?**
Storing inverse relationships would duplicate data and require sync on updates. Computing them via `getInverse()` is a single indexed query — fast enough for real-time use and always consistent.

**Why BFS for traverse, not DFS?**
BFS returns closer nodes first (depth 1 before depth 2), which matches the intuition "what's most directly related?" DFS would return an arbitrary deep path first. Standard graph traversal trade-off — BFS for breadth-first relevance.

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| Build report accounts for every file | total = succeeded + failed.length | `src/engine/builder.ts:26-44` | `test/e2e/full-pipeline.test.ts` > "build from fixtures" |
| Traverse respects depth limit | Prevents runaway traversal on cyclic graphs | `src/engine/reader.ts:58` — `currentDepth >= depth` | `test/unit/engine/reader.test.ts` > "traverse with depth" |
| Traverse deduplicates by slug | Avoids infinite loops on cycles | `src/engine/reader.ts:57` — `visited.has()` | `test/unit/engine/reader.test.ts` > "traverse follows relationships" |
| Section focus extracts content between headings | Focused section contains only that section's prose | `src/engine/reader.ts:131-144` | `test/unit/engine/reader.test.ts` > "get with section focus" |

## Anti-patterns

| Don't do this | Why | Do this instead |
|---------------|-----|-----------------|
| Call builder after reader is created | Reader holds storage refs from build time — works, but confusing lifecycle | Build first, then create reader |
| Traverse without a depth limit | Cyclic graphs cause infinite traversal | Always pass a depth, even if large |
| Pre-compute inverse relationships in builder | Duplicates data, must sync on re-ingest | Compute at query time via getInverse() |
