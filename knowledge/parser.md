---
slug: parser
title: Parser
tags: [parser, module]
relationships:
  depends-on: [pramana, knowledge-artifact, result-type]
---

# Parser

## Specification

```
parseDocument     : string → Result<Artifact, DocumentError>
parseDocumentFile : FilePath → Promise<Result<Artifact, DocumentError>>

DocumentError = FrontmatterError | ReadError | ValidationError
FrontmatterError = { type: "frontmatter", message: string }
ReadError        = { type: "read", message: string }
ValidationError  = { type: "validation", message: string }
```

`parseDocument` is pure (string in, Result out). `parseDocumentFile` adds IO (reads file via `Bun.file`, then delegates to `parseDocument`).

## Pipeline

Three stages composed sequentially. Each stage is a pure function.

### Stage 1: Frontmatter

```
parseFrontmatter : string → Result<FrontmatterData, FrontmatterError>

FrontmatterData = { slug: Slug, title?: string, tags: string[],
                    relationships: Relationship[], body: string }
```

**Input**: raw file content.
**Operation**: match regex `^---\n(.*)\n---\n(.*)$`. Parse the YAML block with a custom lightweight parser. Extract slug (required), title, tags, relationships. Relationship keys must be valid RelType — invalid types are silently dropped by Zod validation.
**Output**: structured frontmatter + remaining body.

Custom YAML parser supports: key-value pairs, inline arrays `[a, b]`, dash-list arrays, one level of nesting (for relationships). Does NOT support multi-line strings, anchors, aliases, or other full-YAML features.

### Stage 2: Sections

```
parseSections : string → Section[]
```

**Input**: body text (after frontmatter).
**Operation**: scan each line for `^(#{2,3})\s+(.+)$`. For each match, produce `{ id: kebabCase(heading), heading, level: hashes.length, line: lineNumber }`.
**Output**: ordered array of sections.

kebab-case transform: lowercase → remove non-alphanumeric (keep spaces, hyphens) → spaces to hyphens → collapse multiple hyphens → trim.

### Stage 3: Wikilinks

```
parseWikilinks : (string, Section[]) → Relationship[]
```

**Input**: body text + sections from stage 2.
**Operation**: scan for regex `\[\[(?:([^:\]]+)::)?([^\]]+)\]\]`. For each match:
- If typed (`[[type::target]]`): use type if it's a valid RelType, else fall back to `relates-to`
- If untyped (`[[target]]`): type = `relates-to`
- Attach line number and containing section id (the nearest section with `line <= current line`)

**Output**: array of relationships with provenance (line, section).

### Composition

```
parseDocument(raw) =
  let fm  = parseFrontmatter(raw)          — fail fast on error
  let sec = parseSections(fm.body)
  let wl  = parseWikilinks(fm.body, sec)
  let rels = fm.relationships ++ wl        — merge frontmatter + wikilink rels
  let hash = sha256(raw)                   — hash the ENTIRE raw input
  let title = fm.title ?? firstH1(fm.body) ?? fm.slug
  validate({ slug: fm.slug, title, tags: fm.tags,
             relationships: rels, sections: sec,
             content: fm.body, hash })      — Zod safeParse
```

## Laws

**P1. Determinism**: `parseDocument(s) = parseDocument(s)` — same input always produces same output.

**P2. Frontmatter required**: no `---` delimiters → `Err(FrontmatterError)`.

**P3. Slug required**: frontmatter without `slug` → `Err(FrontmatterError)`.

**P4. Type safety**: relationship type ∉ RelType → dropped by Zod validation or defaulted to `relates-to`.

**P5. Hash covers entire input**: hash = SHA-256(raw), not SHA-256(body). Frontmatter changes affect the hash.

## Design rationale

**Why custom YAML, not a library?** The subset used is ~80 lines to parse. A full YAML library adds ~50KB for unused features.

**Why wikilinks default to `relates-to`?** Inline mentions are associative context. Structural dependencies belong in frontmatter where they're explicit.
