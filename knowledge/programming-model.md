---
slug: programming-model
title: Programming Model
tags: [meta, programming-model]
relationships:
  depends-on: pramana
---

# Programming Model

How to encode knowledge so it's computable — meaning questions are answerable by composing primitives, not by reading prose.

## The computability principle

If you have to read a paragraph to get the answer, the knowledge is documentation. If `traverse X --type depends-on --depth 3` gives you the answer, it's computable knowledge. Every frontmatter relationship should serve at least one query pattern.

## Two relationship types

| Type | Meaning | Query |
|------|---------|-------|
| `depends-on` | X cannot function without Y | `traverse X --type depends-on` |
| `relates-to` | X and Y are connected, neither requires the other | `traverse X --type relates-to` |

**Why only two?** Every richer vocabulary (`has`, `of`, `implements`, `produces`, `consumes`) is a specialization of `depends-on`. Specializations add cognitive load without adding computability — `traverse X --type depends-on` answers "what does X need?" regardless of whether the edge was "composition" or "implementation". Semantic distinctions belong in prose, not in the edge type.

Enforced by Zod enum at parse time (`src/schema/index.ts:3`).

## Tags

Tags classify artifacts into queryable sets. `list --tags X,Y` returns all artifacts tagged with both X and Y. Tags are freeform but should follow conventions per corpus.

## Wikilinks

`[[target]]` in body text creates a `relates-to` edge (narrative context). `[[depends-on::target]]` creates a `depends-on` edge. Structural dependencies belong in frontmatter; wikilinks are for inline references.

## Query patterns

| Question | Pattern |
|----------|---------|
| What does X depend on? | `traverse X --type depends-on --depth N` |
| What depends on X? | `get X` → `inverseRelationships` where type = depends-on |
| What's related to X? | `traverse X --type relates-to --depth 1` |
| All modules in layer Y? | `list --tags module,Y` |
| What mentions "keyword"? | `search "keyword"` |
| External deps of parser layer? | `list --tags module,parser` → for each, `traverse --type depends-on` → filter by tag `external` |

## Encoding discipline

1. Frontmatter relationships = computable edges (use `depends-on` or `relates-to`)
2. Body wikilinks = narrative context (default `relates-to`)
3. Tags = classification for `list` queries
4. Prose = explanation for humans (WHY, rationale, anti-patterns)
5. If a claim can be a relationship or tag, make it one — don't bury it in prose
