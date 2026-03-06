---
slug: parser
title: Parser
tags: [parser, module]
relationships:
  depends-on: [pramana, knowledge-artifact, result-type]
---

# Parser

Transforms raw Markdown text into validated [[knowledge-artifact]] values through a three-stage pipeline: frontmatter → sections → wikilinks.

## Why this pipeline

**Why three separate stages, not one pass?**
Each stage has a distinct concern: frontmatter extracts metadata, sections extract structure, wikilinks extract inline relationships. Separating them means each can fail independently with a typed error. A single-pass parser would conflate unrelated failures.

**Why a custom YAML parser instead of a library?**
Pramana's frontmatter is a strict subset of YAML: simple key-values, inline arrays, one level of nesting. A full YAML library (js-yaml, yaml) adds ~50KB for features never used. The custom parser handles exactly the subset needed in ~80 lines.

**Why wikilinks default to `relates-to`, not `depends-on`?**
Inline `[[references]]` in prose are usually associative context, not structural dependencies. Structural dependencies belong in frontmatter where they're explicit and intentional. Body wikilinks capture "this is mentioned here" — a weaker claim.

## Stages

1. **Frontmatter** (`src/parser/frontmatter.ts`) — Extracts slug, title, tags, typed relationships from YAML block
2. **Sections** (`src/parser/sections.ts`) — Scans h2/h3 headings, generates kebab-case ids
3. **Wikilinks** (`src/parser/wikilinks.ts`) — Extracts `[[target]]` and `[[type::target]]` patterns with section context

The document parser (`src/parser/document.ts`) orchestrates all three, merges relationships, hashes content, and validates via Zod.

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| No frontmatter → typed error, not exception | Caller handles gracefully | `src/parser/frontmatter.ts:19` — returns Err | `test/unit/parser/frontmatter.test.ts` > "returns error when no frontmatter" |
| Wikilinks track their source line and section | Enables "where was this referenced?" queries | `src/parser/wikilinks.ts:17-22` | `test/unit/parser/wikilinks.test.ts` > "assigns correct section context" |
| Section ids are deterministic kebab-case | Same heading always produces same id | `src/parser/sections.ts:25` — toKebabCase | `test/unit/parser/sections.test.ts` |
| Invalid relationship types rejected | Zod enum validation on the assembled artifact | `src/parser/document.ts:40` — safeParse | `test/unit/parser/document.test.ts` > "parses a complete document" |

## Anti-patterns

| Don't do this | Why | Do this instead |
|---------------|-----|-----------------|
| Add full YAML library as dependency | Overkill for the subset used, adds bundle size | Extend the custom parser if new syntax is needed |
| Put structural dependencies in body wikilinks | They default to `relates-to`, won't show in `--type depends-on` traversals | Declare dependencies in frontmatter |
| Throw in parser functions | Breaks the Result contract | Return `err()` with typed error |
