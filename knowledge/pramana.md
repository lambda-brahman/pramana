---
slug: pramana
title: Pramana
tags: [engine, module]
relationships:
  has: [parser, storage-interface, engine, api, cli, schema, result-type, programming-model]
---

# Pramana

A knowledge engine that turns a directory of Markdown files into a queryable knowledge graph. Files are parsed at startup into an in-memory SQLite database, then exposes four read-only primitives: get, search, traverse, and list.

## Design principles

- Read-only at runtime — all data is ingested once at startup
- No thrown exceptions — every fallible operation returns [[result-type]]
- Manual dependency wiring — no DI framework
- Bun-native — uses bun:sqlite, Bun.serve(), Bun.file, Bun.CryptoHasher

## Data flow

Markdown files are scanned by the [[builder]], which delegates to the [[parser]] to produce [[knowledge-artifact]] values. These are written into [[sqlite-storage]] via the [[storage-interface]]. At query time, the [[reader]] serves requests through the [[api]] or [[cli]].

## Document format

Each source file requires YAML frontmatter with at least a `slug` field. Relationships can be declared in frontmatter as typed key-value pairs, or inline as `[[wikilinks]]`. Sections are extracted from h2/h3 headings and are individually addressable.
