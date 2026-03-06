---
slug: wikilink-parser
title: Wikilink Parser
tags: [parser, module]
relationships:
  depends-on: [parser, relationship, result-type, section]
---

# Wikilink Parser

Extracts [[relationship]] values from inline wikilink syntax in Markdown body text.

## Syntax

- `[[target]]` — creates a `refs` relationship to the target slug
- `[[type::target]]` — creates a relationship with an explicit type

## Section context

Each wikilink is associated with its containing [[section]] (if any). The parser walks through sections by line number to determine which section a wikilink falls under.

## Pattern

The regex `\[\[(?:([^:\]]+)::)?([^\]]+)\]\]` captures an optional type prefix and the target slug.
