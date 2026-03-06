---
slug: engine
title: Engine
tags: [engine, module]
relationships:
  depends-on: [pramana, parser, storage, result-type]
---

# Engine

## Specification

Two components: Builder (write path) and Reader (read path).

### Builder

```
Builder(writer: StorageWriter)
build : DirPath → Promise<Result<BuildReport, EngineError>>

BuildReport = { total: nat, succeeded: nat,
                failed: { file: FilePath, error: DocumentError }[] }
```

**Algorithm**:
1. Glob `**/*.md` in source directory
2. For each file: `parseDocumentFile(path)` → on Ok: `writer.store(artifact)` → on Err: collect in `failed`
3. Return report

Laws L13–L14 from [[programming-model]] apply.

### Reader

```
Reader(storage: StorageReader, searcher: StorageSearcher)

get      : Slug → Result<ArtifactView | null, EngineError>
search   : string → Result<SearchResult[], EngineError>
traverse : (Slug, RelType?, nat) → Result<ArtifactView[], EngineError>
list     : { tags?: string[] }? → Result<ArtifactView[], EngineError>
```

#### get

1. Split input on `#` → (slug, sectionId?)
2. `storage.get(slug)` → if null return Ok(null)
3. `storage.getInverse(slug)` → attach as inverseRelationships
4. If sectionId: find matching section, extract content between this heading and next heading of ≤ level → attach as focusedSection

#### search

Direct delegation: `searcher.search(query)` with error type mapping.

#### traverse

BFS over the relationship graph:

```
traverse(from, relType, depth):
  visited = ∅
  queue = [(from, 0)]
  results = []
  while queue ≠ ∅:
    (slug, d) = dequeue
    if slug ∈ visited ∨ d ≥ depth: continue
    visited = visited ∪ {slug}
    rels = storage.getRelationships(slug)
    if relType: rels = rels.filter(r → r.type = relType)
    for rel in rels:
      target = rel.target.split("#")[0]
      if target ∈ visited: continue
      artifact = storage.get(target)
      if artifact = null: continue
      results.append(toView(artifact))
      enqueue(target, d + 1)
  return Ok(results)
```

Laws L8–L11 from [[programming-model]] apply.

#### list

`storage.list(filter)` → map each artifact through `toView`.

#### toView

```
toView(artifact, storage, sectionId?):
  inverse = storage.getInverse(artifact.slug)
  view = artifact ∧ { inverseRelationships: inverse }
  if sectionId:
    section = artifact.sections.find(s → s.id = sectionId)
    if section:
      content = extractBetween(artifact.content, section, nextSectionOfEqualOrLesserLevel)
      view.focusedSection = { id: section.id, heading: section.heading, content }
  return view
```

#### Error mapping

All StorageErrors are mapped to EngineErrors: `{ type: "engine", message: storageError.message }`. Consumers of the Reader see a uniform error type.

## Design rationale

**Why builder/reader split?** Build is sequential and fallible (parse errors). Read is concurrent and only fails on storage errors. CQRS-like separation — see established literature.

**Why BFS, not DFS?** BFS returns closer nodes first (depth 1 before depth 2), matching the intuition "most directly related."

**Why compute inverse relationships at query time?** Storing inverses would duplicate data and require sync on re-ingest. A single indexed query is fast and always consistent.
