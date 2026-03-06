---
slug: storage
title: Storage
tags: [storage, module]
relationships:
  depends-on: [pramana, knowledge-artifact, result-type]
---

# Storage

## Specification

See [[programming-model]] for interface definitions and laws L1–L7.

```
StorageWriter   = { store }
StorageReader   = { get, list, getRelationships, getInverse }
StorageSearcher = { search }
StoragePlugin   = StorageWriter ∧ StorageReader ∧ StorageSearcher
                  ∧ { initialize, close }
```

Any implementation satisfying laws L1–L7 and L12 is a valid plugin.

## SQLite implementation

The sole implementation. Maps interfaces to SQL operations on an in-memory database.

### Schema (DDL)

```sql
CREATE TABLE artifacts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  tags TEXT NOT NULL,          -- JSON array
  content TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE relationships (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  line INTEGER,
  section TEXT,
  FOREIGN KEY (source) REFERENCES artifacts(slug)
);

CREATE TABLE sections (
  artifact_slug TEXT NOT NULL,
  id TEXT NOT NULL,
  heading TEXT NOT NULL,
  level INTEGER NOT NULL,
  line INTEGER NOT NULL,
  FOREIGN KEY (artifact_slug) REFERENCES artifacts(slug)
);

CREATE VIRTUAL TABLE artifacts_fts USING fts5(
  slug, title, content,
  tokenize='porter unicode61'
);

CREATE INDEX idx_relationships_source ON relationships(source);
CREATE INDEX idx_relationships_target ON relationships(target);
CREATE INDEX idx_sections_slug ON sections(artifact_slug);
```

### Operation mapping

| Interface method | SQL |
|-----------------|-----|
| `store(a)` | Transaction: INSERT OR REPLACE into artifacts, DELETE+INSERT relationships, DELETE+INSERT sections, DELETE+INSERT FTS |
| `get(slug)` | SELECT from artifacts + relationships + sections WHERE slug = ? |
| `list({tags})` | SELECT all from artifacts, filter tags in application code |
| `getRelationships(slug)` | SELECT from relationships WHERE source = ? |
| `getInverse(slug)` | SELECT from relationships WHERE target = ? OR target LIKE ?||'#%' |
| `search(q)` | SELECT from artifacts_fts WHERE MATCH ? with snippet() |
| `initialize()` | PRAGMA journal_mode=WAL; exec DDL |
| `close()` | db.close() |

### Key decisions

**Tags stored as JSON, filtered in app code**: a join table is more "correct" but adds complexity for no gain at this corpus scale. Tag filtering is O(n) over all artifacts — fast enough under ~10K.

**FTS5 with Porter stemmer**: built-in to SQLite, zero dependencies. Porter handles English morphology. `unicode61` tokenizer handles non-ASCII.

**WAL journal mode**: allows concurrent reads during build. Costs nothing to enable.

**Inverse lookup includes section-qualified targets**: `getInverse("X")` matches both `target = "X"` and `target LIKE "X#%"`. This ensures section-level relationships are discoverable from the target artifact.

**Store is transactional**: artifact, relationships, sections, and FTS are updated atomically. Partial writes would leave inconsistent state.

**Upsert via INSERT OR REPLACE**: re-ingesting a changed file replaces the old data. Old relationships and sections are DELETEd before re-INSERT.
