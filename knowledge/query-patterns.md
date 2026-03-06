---
slug: query-patterns
title: Query Patterns
tags: [meta, programming-model]
relationships:
  part-of: programming-model
  needs: [relationship-vocabulary, tag-taxonomy]
---

# Query Patterns

Recipes for computing answers from the knowledge graph. Each pattern is a composition of pramana's four primitives.

## Decompose

**Question:** What are the components of X?

```
pramana traverse <X> --source kb --type has --depth 1
```

Depth 1 gives direct components. Increase depth for full decomposition tree.

## Dependency chain

**Question:** What does X transitively depend on?

```
pramana traverse <X> --source kb --type needs --depth 10
```

Returns the full transitive closure of dependencies.

## Impact analysis

**Question:** If X changes, what is affected downstream?

```
pramana traverse <X> --source kb --type feeds --depth 10
```

Returns everything X feeds into, transitively.

## Input trace

**Question:** Where does the data that X consumes come from?

```
pramana traverse <X> --source kb --type consumes --depth 10
```

## Find implementations

**Question:** What implements interface X?

```
pramana get <X> --source kb
# → read inverseRelationships where type = "impl"
```

Since `impl` points from implementation → interface, the interface's inverse relationships reveal all implementations.

## List by classification

**Question:** What are all the data types in the parser layer?

```
pramana list --source kb --tags type,parser
```

## Keyword discovery

**Question:** What artifacts mention "FTS" or "full-text"?

```
pramana search "full-text" --source kb
```

Search is the entry point when you don't know the slug. From search results, switch to get/traverse for structured queries.

## Composition

Complex questions chain patterns. Example: "What external dependencies does the parser layer need?"

1. `list --tags module,parser` → get all parser modules
2. For each, `traverse <slug> --type needs --depth 1` → collect dependencies
3. `get <dep>` each dependency → check if tagged `external`

This is the programming model: knowledge encoded with the [[relationship-vocabulary]] and [[tag-taxonomy]] becomes answerable by composing primitives.
