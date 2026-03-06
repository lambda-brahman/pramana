---
name: author
description: Create or update knowledge artifacts with auto-profile elicitation
args: tenant topic
user_invocable: true
disable-model-invocation: true
---

# Pramana Author

You are creating or updating a knowledge artifact in a Pramana knowledge base. The user wants to write about: **$ARGUMENTS**

## Step 1: Understand the knowledge base

```bash
pramana list [--tenant <name>]
```

Scan existing artifacts to understand:
- What topics are already covered
- What tags and naming conventions are used
- The overall domain and scope

## Step 2: Check for author profile

```bash
pramana get _meta-author [--tenant <name>]
```

The author profile (`_meta/author.md` in the knowledge directory) captures the user's domain expertise, writing style, and quality standards.

**If the profile exists**: Read it and use it to guide artifact creation.

**If the profile does not exist (404)**: Proceed to Step 3 to elicit one.

## Step 3: Elicit author profile (if missing)

Ask the user these domain-agnostic questions:

1. **Domain**: "What domain does this knowledge base cover? (e.g., law, music theory, software architecture)"
2. **Principles**: "What core principles guide your thinking in this domain? What do you consider non-negotiable?"
3. **Style**: "How do you prefer knowledge to be structured? (e.g., formal definitions first, examples first, narrative, reference-style)"
4. **Completeness**: "What makes a piece of knowledge 'done' in your view? What must every artifact include?"
5. **Audience**: "Who is the intended reader? What can you assume they know?"

Create `_meta/author.md` in the knowledge directory:

```markdown
---
slug: _meta-author
title: Author Profile
tags: [meta]
---

# Author Profile

## Domain
[User's answer]

## Principles
[User's answer]

## Style
[User's answer]

## Completeness criteria
[User's answer]

## Audience
[User's answer]
```

Then reload: `pramana reload [--tenant <name>]`

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

Create the artifact file following Pramana conventions:

### Slug rules
- Lowercase, kebab-case: `my-topic-name`
- Unique within the tenant
- Descriptive but concise (2-4 words ideal)

### Frontmatter
```yaml
---
slug: <kebab-case-slug>
title: <Human Readable Title>
tags: [<domain-tag>, <type-tag>]
relationships:
  depends-on: [<slug1>, <slug2>]
  relates-to: [<slug3>]
---
```

### Body structure
- **H1**: Title (matches frontmatter title)
- **H2**: Major sections (Attributes, Rules, Behavior, Examples, etc.)
- **H3**: Subsections within H2s
- **Wikilinks**: `[[slug]]` for relates-to, `[[depends-on::slug]]` for dependencies
- Content should match the author profile's style preferences

### Quality checklist
- [ ] Slug is kebab-case and unique
- [ ] Tags follow existing conventions in the KB
- [ ] All relationships point to existing artifacts (or planned ones)
- [ ] Sections use H2/H3 properly (no H4+, no skipped levels)
- [ ] Wikilinks connect to related concepts
- [ ] Content matches author profile's completeness criteria

## Step 6: Save and reload

Save the file to the knowledge directory, then reload:

```bash
pramana reload [--tenant <name>]
```

Verify the artifact was ingested:
```bash
pramana get <new-slug> [--tenant <name>]
```

Check that relationships resolve:
```bash
pramana traverse <new-slug> --depth 1 [--tenant <name>]
```

## Multi-tenant awareness

- Parse the first argument as the tenant name if provided
- If no tenant specified and multiple tenants exist, ask the user which tenant to write to
- Always use `--tenant` in commands when working with a specific tenant
- The `_meta/author.md` profile is per-tenant (each knowledge base can have different authoring standards)
