---
slug: section
title: Section
tags: [schema, type]
relationships:
  depends-on: knowledge-artifact
---

# Section

A navigable heading within a [[knowledge-artifact]]. Sections make parts of a document individually addressable.

## Fields

- **id** — kebab-case identifier derived from the heading text
- **heading** — the original heading text
- **level** — heading depth (2 for `##`, 3 for `###`)
- **line** — 1-based line number in the body

## Addressing

Sections can be targeted in relationships using `slug#section-id` syntax. The [[reader]] supports focused section retrieval via `get("slug#section-id")`, which returns the full artifact with a `focusedSection` field containing the section's extracted content.

## Extraction

Only h2 and h3 headings are extracted. The h1 is treated as the document title, not a section.
