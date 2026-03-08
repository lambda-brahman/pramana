---
name: write
description: Create or update knowledge artifacts using an existing author agent
args: tenant topic
user_invocable: true
---

# Pramana Write

You are creating or updating a knowledge artifact in a Pramana knowledge base. The user wants to write about: **$ARGUMENTS**

## Step 1: Understand the knowledge base

```bash
pramana list [--tenant <name>]
```

Scan existing artifacts to understand:
- What topics are already covered
- What tags and naming conventions are used
- The overall domain and scope

## Step 2: Resolve author

Find the source directory for this tenant, then scan for available author agents:

```bash
ls <source-dir>/_meta/author-*.md 2>/dev/null
```

### If `--author <name>` was provided:
Read the specified author agent file:
```bash
cat <source-dir>/_meta/author-<name>.md
```
If the file doesn't exist, **STOP** and instruct the user:
```
Author "author-<name>" not found. Create it first:
/pramana:create-author <tenant> <name>
```

### If `--author` was not provided:
- **If authors exist**: List them and ask the user which one to use.
- **If no authors exist**: **STOP** and instruct the user:
  ```
  No author agents found. Create one first:
  /pramana:create-author <tenant> <author-name>
  ```

## Step 3: Become the author agent

Read the author's agent file from disk. The file has two parts:
- **YAML frontmatter** — agent metadata (name, description, model)
- **Markdown body** — the agent's system prompt (persona, style, conventions, quality standards)

Adopt the markdown body as your persona for artifact creation. Think, write, and structure knowledge according to this persona's instructions.

## Step 4: Research connections

Before writing, find related artifacts:

```bash
pramana search "<topic keywords>" [--tenant <name>]
```

For each relevant result:
```bash
pramana get <slug>#<relevant-section> [--tenant <name>]
```

Identify:
- What existing artifacts should this one link to?
- What relationship types apply? (`depends-on` for structural, `relates-to` for associative)
- Are there gaps this artifact fills?

## Step 5: Draft the artifact

Create the artifact as the author agent, following the persona's style, conventions, and quality standards.

### Slug rules
- Lowercase, kebab-case: `my-topic-name`
- Unique within the tenant
- Descriptive but concise (2-4 words ideal)

### Frontmatter

The parser enforces these requirements:

```yaml
---
slug: <kebab-case-slug>           # REQUIRED — non-empty, kebab-case, unique per corpus
title: <Human Readable Title>     # Optional (falls back to first H1, then slug) — always set explicitly
tags: [<domain-tag>, <type-tag>]  # Array (empty if absent)
relationships:
  depends-on: [<slug1>, <slug2>]  # Keys must be valid RelType: "depends-on" | "relates-to"
  relates-to: [<slug3>]           # Values: string or string[]
---
```

### Body structure
- **H1**: Title (matches frontmatter title)
- **H2**: Major sections (Attributes, Rules, Behavior, Examples, etc.)
- **H3**: Subsections within H2s
- **No H4+**: Too granular for graph addressing (sections only track H2/H3)
- **Wikilinks**: `[[slug]]` for relates-to, `[[depends-on::slug]]` for dependencies
- **Section IDs**: Derived as kebab-case of heading text
- Content should match the author agent's style and conventions

### Quality checklist
- [ ] Slug is kebab-case and unique
- [ ] Tags follow existing conventions in the KB
- [ ] All relationships point to existing artifacts (or planned ones)
- [ ] Sections use H2/H3 properly (no H4+, no skipped levels)
- [ ] Wikilinks connect to related concepts
- [ ] Content matches the author agent's quality standards
- [ ] Relationship keys are valid RelType (`depends-on` | `relates-to`) — invalid types are silently dropped

## Step 6: Save and reload

Save the file to the knowledge directory, then reload:

```bash
pramana reload [--tenant <name>]
```

Verify the artifact was ingested:
```bash
pramana get <new-slug> [--tenant <name>]
```

If ingestion fails, read the error (frontmatter/validation/read), fix, and retry.

Check that relationships resolve:
```bash
pramana traverse <new-slug> --depth 1 [--tenant <name>]
```

## Multi-tenant awareness

- Parse the first argument as the tenant name if provided
- If no tenant specified and multiple tenants exist, ask the user which tenant to write to
- Always use `--tenant` in commands when working with a specific tenant
- Author agents are per-tenant (each knowledge base can have different authoring standards)
