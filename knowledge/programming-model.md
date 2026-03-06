---
slug: programming-model
title: Programming Model
tags: [meta, programming-model]
relationships:
  depends-on: [pramana, relationship-vocabulary, tag-taxonomy, query-patterns]
---

# Programming Model

The [[pramana]] programming model defines how knowledge is encoded so that it becomes computable — meaning the four primitives (get, search, traverse, list) can derive answers, not just retrieve text.

## The computability principle

Knowledge is computable when a question can be answered by a finite composition of primitives. If you have to read prose to get the answer, the knowledge is documentation. If you can traverse a typed graph or filter by tags, it's computable.

## Two relationship types

Only two: `depends-on` and `relates-to`. See [[relationship-vocabulary]].

`depends-on` is the workhorse — it encodes every structural, contractual, and operational dependency. `relates-to` is for associative context that doesn't imply dependency.

## Tag taxonomy

A fixed set of [[tag-taxonomy]] categories. Tags classify artifacts into computable sets. `list --tags X` returns a meaningful, complete set.

## Query patterns

[[query-patterns]] are recipes for composing primitives to answer specific questions. They are the "programs" you write against the knowledge graph.

## Encoding discipline

When adding knowledge to pramana:

1. Use `depends-on` for any relationship where X needs Y to function
2. Use `relates-to` for associative cross-references
3. Assign tags from the [[tag-taxonomy]]
4. Verify computability: can your intended question be answered by a query pattern without reading prose?
