---
slug: knowledge-artifact
title: Knowledge Artifact
tags: [schema, type]
relationships:
  depends-on: [schema, relationship, section, zod]
---

# Knowledge Artifact

The core data type in [[pramana]]. Represents a single parsed Markdown document.

## Fields

- **slug** — unique identifier, derived from frontmatter
- **title** — from frontmatter `title` field, or the first h1 heading, or falls back to slug
- **tags** — array of strings from frontmatter
- **relationships** — array of [[relationship]] values, from both frontmatter and [[wikilink-parser]]
- **sections** — array of [[section]] values extracted by the [[section-parser]]
- **content** — the Markdown body (everything after frontmatter)
- **hash** — SHA-256 of the raw file content

## Validation

The artifact is validated at parse time using a Zod schema (`KnowledgeArtifactSchema`). Invalid documents produce a typed error rather than throwing.
