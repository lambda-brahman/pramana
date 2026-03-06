---
slug: tag-taxonomy
title: Tag Taxonomy
tags: [meta, programming-model]
relationships:
  depends-on: programming-model
---

# Tag Taxonomy

Tags classify artifacts into computable sets. `list --tags X` returns all artifacts of type X. Tags are not freeform labels — they come from this taxonomy.

## Layer tags

What architectural layer the artifact belongs to:

| Tag | Meaning |
|-----|---------|
| `parser` | Document parsing pipeline |
| `storage` | Persistence and retrieval |
| `engine` | Build and query orchestration |
| `api` | HTTP interface |
| `cli` | Command-line interface |
| `lib` | Shared utilities |
| `schema` | Data type definitions |

`list --tags parser` returns all parser-layer artifacts.

## Kind tags

What kind of thing the artifact describes:

| Tag | Meaning |
|-----|---------|
| `module` | A code module or component |
| `type` | A data type or schema |
| `pattern` | A design pattern or convention |
| `interface` | A contract between components |
| `external` | An external dependency |

`list --tags module` returns all modules. `list --tags type` returns all data types.

## Meta tag

| Tag | Meaning |
|-----|---------|
| `meta` | About the knowledge system itself |

`list --tags meta` returns the programming model documents.

## Combining tags

Tags compose via intersection. `list --tags module,parser` returns modules in the parser layer. Every artifact should have exactly one layer tag and one kind tag (plus `meta` if applicable).
