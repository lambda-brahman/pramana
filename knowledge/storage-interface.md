---
slug: storage-interface
title: Storage Interface
tags: [storage, interface]
relationships:
  of: pramana
---

# Storage Interface

Defines the contract between the [[engine]] and the storage layer. Composed of four interfaces.

## StorageWriter

- `store(artifact)` — persist a [[knowledge-artifact]]

## StorageReader

- `get(slug)` — retrieve a single artifact by slug
- `list(filter?)` — list all artifacts, optionally filtered by tags
- `getRelationships(slug)` — get outgoing relationships for an artifact
- `getInverse(slug)` — get incoming relationships pointing to an artifact

## StorageSearcher

- `search(query)` — full-text search returning slug, title, snippet, and rank

## StoragePlugin

Combines all three interfaces plus lifecycle methods:

- `initialize()` — set up storage (create tables, etc.)
- `close()` — clean up resources

All methods return [[result-type]] values, never throw.
