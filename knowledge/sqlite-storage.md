---
slug: sqlite-storage
title: SQLite Storage
tags: [storage, module]
relationships:
  depends-on: [pramana, storage-interface, result-type, knowledge-artifact]
---

# SQLite Storage

The [[storage-interface]] implementation using `bun:sqlite`. Runs as an in-memory database by default.

## Schema

Three tables plus one FTS virtual table:

- **artifacts** — slug (PK), title, tags (JSON), content, hash
- **relationships** — source, target, type, line, section (indexed on both source and target)
- **sections** — artifact_slug, id, heading, level, line
- **artifacts_fts** — FTS5 virtual table over slug, title, content with Porter stemming and unicode61 tokenizer

## Write path

`store()` runs in a transaction: upserts the artifact, deletes and re-inserts relationships and sections, and updates the FTS index.

## Read path

`get()` joins artifacts with their relationships and sections. `list()` fetches all artifacts with optional tag filtering done in application code. `search()` uses FTS5 MATCH with snippet extraction.

## Inverse relationships

`getInverse()` queries relationships where the target matches the slug, including section-qualified targets (`slug#section`).

## Configuration

WAL journal mode is enabled at initialization for better concurrent read performance.
