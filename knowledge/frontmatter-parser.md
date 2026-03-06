---
slug: frontmatter-parser
title: Frontmatter Parser
tags: [module, parser]
relationships:
  part-of: parser
  produces: [relationship, knowledge-artifact]
---

# Frontmatter Parser

Extracts YAML frontmatter from the top of a Markdown file. The frontmatter block is delimited by `---` markers.

## Required fields

- **slug** — string, must be non-empty

## Optional fields

- **title** — string
- **tags** — array of strings, supports both `[inline, syntax]` and dash-list syntax
- **relationships** — nested object where keys are relationship types and values are slugs or arrays of slugs

## YAML parser

Uses a custom lightweight YAML parser (not a full YAML library). Supports:

- Simple key-value pairs
- Inline arrays `[a, b, c]`
- Dash-list arrays
- One level of nested objects (for relationships)
- Comments with `#`

Does not support multi-line strings, anchors, or other advanced YAML features.
