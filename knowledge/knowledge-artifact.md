---
slug: knowledge-artifact
title: Knowledge Artifact
tags: [schema, type]
relationships:
  depends-on: pramana
---

# Knowledge Artifact

The atomic unit of knowledge. One Markdown file → one artifact with a unique slug, typed relationships, and navigable sections.

## Why this structure

**Why slug as the primary key, not file path?**
File paths are filesystem concerns — they change with refactoring. Slugs are stable identifiers chosen by the author. Relationships reference slugs, so they survive file moves. The frontmatter `slug` field is mandatory for this reason.

**Why store raw content, not rendered HTML?**
The engine is a knowledge graph, not a CMS. Consumers (APIs, CLIs, future UIs) decide how to render. Storing raw Markdown preserves author intent and avoids coupling to a rendering pipeline.

**Why SHA-256 hash?**
Content-addressable identity. Two artifacts with different slugs but identical content can be detected. Enables future incremental rebuild — skip files whose hash hasn't changed.

**Why sections from h2/h3 only?**
h1 is the document title (redundant with `title`). h4+ is too granular for graph addressing. h2/h3 gives a useful two-level table of contents. Sections are addressable as `slug#section-id` in relationships and API calls.

## Fields

- **slug** — unique identifier from frontmatter (required)
- **title** — from frontmatter, or first h1, or falls back to slug
- **tags** — classification labels from frontmatter
- **relationships** — typed edges to other artifacts (frontmatter + wikilinks)
- **sections** — h2/h3 headings with kebab-case ids
- **content** — Markdown body after frontmatter
- **hash** — SHA-256 of the raw file including frontmatter

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| slug is required and non-empty | Every artifact must be addressable | `src/parser/frontmatter.ts:32` | `test/unit/parser/frontmatter.test.ts` > "returns error when slug is missing" |
| hash is deterministic | Same content always produces same hash | `src/lib/hash.ts` — Bun.CryptoHasher("sha256") | `test/unit/parser/document.test.ts` > "produces deterministic hash" |
| Validated by Zod at parse time | Malformed documents fail fast with typed errors | `src/parser/document.ts:40` — safeParse | `test/unit/parser/document.test.ts` > "parses a complete document" |
| Relationship types constrained to enum | Prevents ad-hoc, unqueryable relationship types | `src/schema/index.ts:3` — RELATIONSHIP_TYPES | `test/unit/parser/frontmatter.test.ts` > "parses slug, tags, and relationships" |

## Anti-patterns

| Don't do this | Why | Do this instead |
|---------------|-----|-----------------|
| Omit the slug field | Parser rejects the document entirely | Always include `slug` in frontmatter |
| Use h1 for sections | h1 is the title, not a section | Use h2/h3 for navigable sections |
| Invent relationship types outside the enum | Zod rejects them at parse time | Use `depends-on` or `relates-to` |
