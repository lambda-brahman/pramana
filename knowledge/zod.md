---
slug: zod
title: Zod
tags: [lib, external]
---

# Zod

External validation library used by [[pramana]] for runtime type checking. Provides schema definitions that double as TypeScript type sources via `z.infer<>`.

## Usage in Pramana

- `KnowledgeArtifactSchema` validates parsed documents in the [[parser]]
- `FrontmatterRelationshipsSchema` validates the relationships block in [[frontmatter-parser]]
- Type inference eliminates duplicate type definitions
