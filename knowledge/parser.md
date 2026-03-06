---
slug: parser
title: Parser
tags: [parser, module]
relationships:
  depends-on: [pramana, frontmatter-parser, section-parser, wikilink-parser, knowledge-artifact, result-type]
---

# Parser

The parser module transforms raw Markdown text into [[knowledge-artifact]] values. It is composed of three sub-parsers orchestrated by the document parser.

## Document parser

The entry point. Coordinates the parsing pipeline:

1. [[frontmatter-parser]] extracts slug, title, tags, relationships, and body
2. [[section-parser]] extracts headings from the body
3. [[wikilink-parser]] extracts inline relationships from the body
4. Frontmatter and wikilink relationships are merged
5. Content is hashed with SHA-256
6. The result is validated against the Zod schema

Also provides `parseDocumentFromFile` which reads a file using `Bun.file` before parsing.

## Error handling

Each sub-parser returns typed errors via [[result-type]]. The document parser propagates these without throwing.
