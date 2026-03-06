---
slug: schema
title: Schema
tags: [schema, module]
relationships:
  of: pramana
  has: [knowledge-artifact, relationship, section]
  needs: zod
---

# Schema

The schema module defines Zod schemas and TypeScript types for all core data structures in [[pramana]].

## Schemas

- **KnowledgeArtifactSchema** — the top-level document schema
- **RelationshipSchema** — a directed edge with target, type, and optional line/section
- **SectionSchema** — a heading with id, heading text, level, and line number
- **FrontmatterRelationshipsSchema** — validates the relationships block in frontmatter as a record of string to string-or-array

## Usage

Zod schemas serve dual purpose: runtime validation in the [[parser]] and TypeScript type inference via `z.infer<>`.
