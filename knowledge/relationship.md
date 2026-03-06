---
slug: relationship
title: Relationship
tags: [schema, core]
relationships:
  part-of: knowledge-artifact
  produced-by: [frontmatter-parser, wikilink-parser]
---

# Relationship

A directed edge in the knowledge graph connecting one [[knowledge-artifact]] to another.

## Fields

- **target** — slug of the target artifact (may include `#section-id`)
- **type** — the relationship type (e.g. `relates-to`, `depends-on`, `composed-of`)
- **line** — source line number where the relationship was found (optional)
- **section** — id of the containing section (optional)

## Sources

Relationships come from two places:

1. **Frontmatter** — declared under the `relationships` key as typed key-value pairs. The key is the relationship type, the value is a slug or array of slugs.
2. **Wikilinks** — inline `[[target]]` references in the body. The default type is `relates-to`. A typed form `[[type::target]]` sets an explicit type.

## Inverse relationships

The [[reader]] computes inverse relationships at query time by looking up all relationships where the current artifact is the target.
