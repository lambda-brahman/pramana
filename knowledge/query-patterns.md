---
slug: query-patterns
title: Query Patterns
tags: [meta, programming-model]
relationships:
  depends-on: [programming-model, relationship-vocabulary, tag-taxonomy]
---

# Query Patterns

Recipes for computing answers from the knowledge graph using the two relationship types and four primitives.

## Dependency chain

**Question:** What does X transitively depend on?

```
pramana traverse <X> --source kb --type depends-on --depth 10
```

## What depends on X?

**Question:** If X changes, what is affected?

```
pramana get <X> --source kb
# → inverseRelationships where type = "depends-on"
```

## Related context

**Question:** What is associated with X?

```
pramana traverse <X> --source kb --type relates-to --depth 1
```

## List by classification

**Question:** What are all the modules in the parser layer?

```
pramana list --source kb --tags module,parser
```

## Keyword discovery

**Question:** What artifacts mention "FTS"?

```
pramana search "FTS" --source kb
```

## Composition

Complex questions chain patterns. Example: "What external dependencies does the parser layer need?"

1. `list --tags module,parser` → get all parser modules
2. For each, `traverse <slug> --type depends-on --depth 1` → collect dependencies
3. `get <dep>` each dependency → check if tagged `external`
