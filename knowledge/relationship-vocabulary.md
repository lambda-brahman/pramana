---
slug: relationship-vocabulary
title: Relationship Vocabulary
tags: [meta, programming-model]
relationships:
  depends-on: programming-model
---

# Relationship Vocabulary

Two relationship types. That's it.

## depends-on

X cannot function without Y. Directed and transitive.

Subsumes composition, implementation, data flow, and requirement. If X needs Y for any reason — structural, contractual, or operational — it's `depends-on`.

`traverse X --type depends-on --depth N` computes the transitive dependency set. Inverse relationships on `get X` reveal what depends on X.

## relates-to

X and Y are connected but neither requires the other. Associative context.

This is the default type for `[[wikilinks]]` in body text. Use it in frontmatter for explicit cross-references that aren't dependencies.

## Why only two

Every richer vocabulary (`has`, `of`, `implements`, `produces`, `consumes`, `feeds`) is a specialization of `depends-on`. Specializations add cognitive load without adding computability — `traverse X --type depends-on` answers the same question regardless of whether the edge was "composition" or "implementation". If you need the semantic distinction, put it in prose, not in the relationship type.
