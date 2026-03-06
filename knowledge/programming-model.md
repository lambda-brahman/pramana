---
slug: programming-model
title: Programming Model
tags: [meta, programming-model]
relationships:
  part-of: pramana
  composed-of: [relationship-vocabulary, tag-taxonomy, query-patterns]
---

# Programming Model

The [[pramana]] programming model defines how knowledge is encoded so that it becomes computable — meaning the four primitives (get, search, traverse, list) can derive answers, not just retrieve text.

## The computability principle

Knowledge is computable when a question can be answered by a finite composition of primitives. If you have to read prose to get the answer, the knowledge is documentation. If you can traverse a typed graph or filter by tags, it's computable.

## Three pillars

### Relationship vocabulary

A fixed set of [[relationship-vocabulary]] types with defined directionality. Every relationship type has a forward direction (source → target) and a computable meaning. No synonyms — one type per semantic.

### Tag taxonomy

A fixed set of [[tag-taxonomy]] categories. Tags classify artifacts into computable sets. `list --tags X` must return a meaningful, complete set.

### Query patterns

[[query-patterns]] are recipes for composing primitives to answer specific questions. They are the "programs" you write against the knowledge graph.

## Encoding discipline

When adding knowledge to pramana:

1. Choose relationship types only from the [[relationship-vocabulary]]
2. Assign tags only from the [[tag-taxonomy]]
3. Verify computability: can your intended question be answered by a query pattern without reading prose?
4. Wikilinks in body text are for narrative context — computable relationships go in frontmatter
