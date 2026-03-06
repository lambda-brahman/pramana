---
slug: relationship-vocabulary
title: Relationship Vocabulary
tags: [meta, programming-model]
relationships:
  part-of: programming-model
---

# Relationship Vocabulary

The closed set of relationship types. Every frontmatter relationship must use one of these. Wikilinks in body text default to `refs` (narrative reference).

## Structural

| Type | Meaning | Traversal computes |
|------|---------|-------------------|
| `has` | source contains target as a component | decomposition tree |
| `of` | source is a component of target | upward containment |

`has` and `of` are inverses. Use `has` on the parent, `of` on the child. `traverse X --type has --depth N` computes the full decomposition to depth N.

## Dependency

| Type | Meaning | Traversal computes |
|------|---------|-------------------|
| `needs` | source requires target to function | dependency chain |
| `feeds` | source provides output consumed by target | data flow forward |

`traverse X --type needs --depth N` computes the transitive dependency set. `traverse X --type feeds --depth N` computes the downstream impact set.

## Realization

| Type | Meaning | Traversal computes |
|------|---------|-------------------|
| `impl` | source implements the contract defined by target | implementations of an interface |

`traverse interface --type impl` from an interface is meaningless (wrong direction). Instead, `list` all artifacts and filter, or use inverse relationships on get.

## Production

| Type | Meaning | Traversal computes |
|------|---------|-------------------|
| `produces` | source creates/emits target as output | output trace |
| `consumes` | source takes target as input | input trace |

`traverse X --type produces --depth N` computes what X generates transitively. `traverse X --type consumes --depth N` computes the input ancestry.

## Narrative

| Type | Meaning | Traversal computes |
|------|---------|-------------------|
| `refs` | source mentions target in prose | nothing computable — context only |

`refs` is the default for `[[wikilinks]]` in body text. It explicitly marks non-computable references. Do not use `refs` in frontmatter — if a relationship is worth declaring in frontmatter, it should be typed.

## Summary

Seven types total: `has`, `of`, `needs`, `feeds`, `impl`, `produces`, `consumes`, plus `refs` for body wikilinks.
