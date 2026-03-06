---
slug: section-parser
title: Section Parser
tags: [module, parser]
relationships:
  part-of: parser
  produces: section
---

# Section Parser

Extracts [[section]] values from Markdown body text by scanning for h2 (`##`) and h3 (`###`) headings.

## Heading ID generation

Heading text is converted to a kebab-case id:

1. Lowercase the text
2. Remove non-alphanumeric characters (except spaces and hyphens)
3. Replace spaces with hyphens
4. Collapse multiple hyphens
5. Trim leading/trailing hyphens

## Scope

Only h2 and h3 headings are recognized. The h1 heading is treated as the document title by the [[frontmatter-parser]] fallback, not as a section.
