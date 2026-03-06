---
slug: programming-model
title: Programming Model
tags: [meta, programming-model]
relationships:
  depends-on: pramana
---

# Programming Model

The abstract machine underlying pramana. Defines the types, interfaces, operations, and laws — independent of SQLite, Bun, or any implementation detail.

## Types

```
Slug        = nonempty string
Tag         = string
RelType     = "depends-on" | "relates-to"
Relationship = { target: Slug, type: RelType }
Section      = { id: Slug, heading: string, level: 2 | 3 }
Artifact     = { slug: Slug, title: string, tags: Tag[],
                 relationships: Relationship[], sections: Section[],
                 content: string, hash: string }
Result<T, E> = Ok(T) | Err(E)
```

`Artifact` is the element. `Slug` is the key. `Relationship` is a labeled directed edge. `Result` is a total error wrapper — every operation is total (no exceptions).

## Interfaces

### StorageWriter

```
store : Artifact → Result<void, E>
```

Single operation. Accepts a validated artifact and persists it.

### StorageReader

```
get              : Slug → Result<Artifact | null, E>
list             : { tags?: Tag[] }? → Result<Artifact[], E>
getRelationships : Slug → Result<Relationship[], E>
getInverse       : Slug → Result<Relationship[], E>
```

Four read operations. `get` is point lookup. `list` is filtered enumeration. `getRelationships` returns outgoing edges. `getInverse` returns incoming edges.

### StorageSearcher

```
search : string → Result<SearchResult[], E>
```

Free-text query. Returns ranked results with snippets.

### StoragePlugin

```
StoragePlugin = StorageWriter ∧ StorageReader ∧ StorageSearcher ∧ {
  initialize : () → Result<void, E>
  close      : () → Result<void, E>
}
```

Lifecycle-aware composition of all three interfaces.

### Reader (engine layer)

```
get      : Slug → Result<ArtifactView | null, E>
search   : string → Result<SearchResult[], E>
traverse : Slug × RelType? × Depth → Result<ArtifactView[], E>
list     : { tags?: Tag[] }? → Result<ArtifactView[], E>
```

Wraps StorageReader and StorageSearcher. `traverse` is the only operation not in the storage layer — it is derived from `getRelationships` + `get` via BFS.

### Builder (engine layer)

```
build : DirPath → Result<BuildReport, E>
```

Scans a directory, parses each file, calls `store` for each valid artifact. Partial failure is tolerated — invalid files are collected in the report.

## Laws

### Storage laws

**L1. Store-Get roundtrip**
```
store(a).ok ⟹ get(a.slug) = Ok(a')
  where a'.slug = a.slug ∧ a'.title = a.title ∧ a'.tags = a.tags
        ∧ a'.relationships = a.relationships ∧ a'.hash = a.hash
```

**L2. Store idempotence**
```
store(a); store(a) ≡ store(a)
```
Storing the same artifact twice has no observable effect beyond one store.

**L3. Get-miss**
```
slug ∉ stored ⟹ get(slug) = Ok(null)
```
Missing slugs return null, not an error.

**L4. Relationship duality**
```
store(a) where (a.slug = s, a.relationships ∋ {target: t, type: τ})
⟹ getRelationships(s) ∋ {target: t, type: τ}
   ∧ getInverse(t) ∋ {target: s, type: τ}
```
Every stored outgoing edge is observable both forward and inverse.

**L5. List completeness**
```
list() = Ok(A) ⟹ ∀a ∈ stored : a ∈ A
```
Unfiltered list returns every stored artifact.

**L6. Tag filtering is intersection**
```
list({tags: [t₁, t₂]}) = Ok(A)
⟹ A = { a ∈ stored | t₁ ∈ a.tags ∧ t₂ ∈ a.tags }
```
Multiple tags filter conjunctively (AND), not disjunctively.

**L7. Search inclusion**
```
store(a) where a.content contains term q
⟹ search(q) ∋ {slug: a.slug, ...}
```
Stored content is searchable. (Modulo tokenization — stemmed terms may differ from exact substrings.)

### Traverse laws

**L8. Traverse base case**
```
traverse(s, τ, 0) = Ok([])
```
Depth zero yields nothing.

**L9. Traverse monotonicity**
```
traverse(s, τ, n) ⊆ traverse(s, τ, n+1)
```
Increasing depth never removes results.

**L10. Traverse termination**
```
∃ N : traverse(s, τ, N) = traverse(s, τ, N+1)
```
The graph is finite, so traversal reaches a fixed point.

**L11. Traverse acyclicity (via visited set)**
```
∀ a ∈ traverse(s, τ, n) : a appears at most once
```
The visited-set deduplication guarantees no artifact appears twice, even in cyclic graphs.

### Result laws

**L12. Totality**
```
∀ operation f, input x : f(x) = Ok(v) ∨ f(x) = Err(e)
```
No operation throws. Every call returns a Result.

### Build laws

**L13. Build accounting**
```
build(dir) = Ok(report)
⟹ report.total = report.succeeded + |report.failed|
```
Every file is accounted for — either succeeded or failed.

**L14. Partial failure tolerance**
```
file f is malformed ⟹ f ∈ report.failed ∧ all other valid files still stored
```
One bad file doesn't prevent ingestion of the rest.

## Plugin contract

Any implementation of `StoragePlugin` must satisfy laws L1–L7 and L12. The traverse laws (L8–L11) are enforced by the Reader, not the plugin. The build laws (L13–L14) are enforced by the Builder.

This means a new storage backend (persistent file, remote database) only needs to satisfy the storage laws to be a valid plugin.
