---
slug: reader
title: Reader
tags: [engine, module]
relationships:
  of: engine
  needs: storage-interface
  feeds: [api, cli]
---

# Reader

The read-path component of the [[engine]]. Provides four query primitives over the knowledge graph.

## Primitives

### get

Retrieves a single [[knowledge-artifact]] by slug. Supports section-qualified slugs (`slug#section-id`) which populate a `focusedSection` field with the section's extracted content. Computes inverse relationships at query time.

### search

Full-text search delegated to the [[sqlite-storage]] FTS5 index. Returns slug, title, snippet (with `<mark>` highlighting), and rank.

### traverse

Graph traversal starting from a slug. Walks outgoing [[relationship]] edges using BFS up to a configurable depth. Optionally filters by relationship type. Returns all reached artifacts as views.

### list

Returns all artifacts, optionally filtered by tags. Each artifact is returned as a full view with inverse relationships.

## ArtifactView

The reader wraps raw [[knowledge-artifact]] values into `ArtifactView` which adds `inverseRelationships` and optional `focusedSection`.
