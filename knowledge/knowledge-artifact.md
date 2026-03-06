---
slug: knowledge-artifact
title: Knowledge Artifact
tags: [schema, type]
relationships:
  depends-on: pramana
---

# Knowledge Artifact

## Specification

```
RelType      = "depends-on" | "relates-to"
Relationship = { target: Slug, type: RelType, line?: nat, section?: Slug }
Section      = { id: Slug, heading: string, level: 2 | 3, line: nat }
Artifact     = { slug: Slug, title: string, tags: string[],
                 relationships: Relationship[], sections: Section[],
                 content: string, hash: string }
```

Validated at construction time by Zod schemas. Invalid data produces `Err`, never a partial artifact.

## Schemas (Zod)

```
RelationshipTypeSchema  = z.enum(["depends-on", "relates-to"])
RelationshipSchema      = z.object({ target: z.string(), type: RelationshipTypeSchema,
                                     line: z.number().optional(), section: z.string().optional() })
SectionSchema           = z.object({ id: z.string(), heading: z.string(),
                                     level: z.number(), line: z.number() })
KnowledgeArtifactSchema = z.object({ slug: z.string(), title: z.string(),
                                     tags: z.array(z.string()),
                                     relationships: z.array(RelationshipSchema),
                                     sections: z.array(SectionSchema),
                                     content: z.string(), hash: z.string() })
FrontmatterRelationshipsSchema = z.record(RelationshipTypeSchema,
                                          z.union([z.string(), z.array(z.string())]))
```

TypeScript types are inferred via `z.infer<>` — no duplicate type definitions.

## Field semantics

| Field | Source | Invariant |
|-------|--------|-----------|
| slug | frontmatter `slug` (required) | non-empty, unique per corpus |
| title | frontmatter `title`, else first h1, else slug | always resolved to a string |
| tags | frontmatter `tags` array | empty array if absent |
| relationships | frontmatter relationships + body wikilinks merged | type ∈ RelType (Zod-enforced) |
| sections | h2/h3 headings from body | id = kebab-case(heading), level ∈ {2, 3} |
| content | body text after frontmatter delimiter | raw markdown, not rendered |
| hash | SHA-256 of entire raw file (including frontmatter) | deterministic, hex-encoded, 64 chars |

## Derived type: ArtifactView

```
ArtifactView = Artifact ∧ {
  inverseRelationships: Relationship[],
  focusedSection?: { id: Slug, heading: string, content: string }
}
```

Computed at query time by the Reader. `inverseRelationships` are all edges in the graph where `target = this.slug`. `focusedSection` is populated when querying `slug#section-id`.

## Section addressing

Slug supports fragment syntax: `slug#section-id`. The `#` delimiter splits slug from section. Section content is extracted as the text between the section heading and the next heading of equal or lesser depth.

## Design rationale

**Why slug, not file path?** Slugs survive file renames. Relationships reference slugs.

**Why SHA-256?** Content-addressable identity. Enables future incremental rebuild — skip files whose hash hasn't changed.

**Why h2/h3 only?** h1 is the title. h4+ is too granular for graph addressing.
