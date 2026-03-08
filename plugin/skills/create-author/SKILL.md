---
name: create-author
description: Build a named author agent through interactive elicitation for a Pramana knowledge base
args: tenant author-name
user_invocable: true
disable-model-invocation: true
---

# Pramana Create Author

You are building a named author agent for a Pramana knowledge base. The user wants to create an author agent for: **$ARGUMENTS**

## Step 1: Parse arguments

Extract the tenant name and author name from the arguments. Both are **required**.

If the author name is missing, **STOP** and ask the user to provide one:
```
Usage: /pramana:create-author <tenant> <author-name>
Example: /pramana:create-author commerce api-docs
```

Every author must be named — there is no default.

## Step 2: Locate source directory

Find the source directory for this tenant by checking the running daemon:

```bash
pramana tenants
```

The source directory is where the tenant's knowledge files live.

## Step 3: List existing authors

Scan for existing author agents in both project-level and global agent directories:

```bash
ls .claude/agents/author-*-<tenant>.md 2>/dev/null
ls ~/.claude/agents/author-*-<tenant>.md 2>/dev/null
```

Show what already exists so the user has context.

## Step 4: Check target author

Check if the target author agent already exists:

```bash
cat .claude/agents/author-<name>-<tenant>.md 2>/dev/null || cat ~/.claude/agents/author-<name>-<tenant>.md 2>/dev/null
```

- **If it exists**: Show the current content and ask the user what they want to update.
- **If it doesn't exist**: Proceed to elicitation.

## Step 5: Open-ended elicitation

Conduct an open-ended elicitation to build a fine-grained understanding of the author agent. There are no fixed fields — start with broad questions and keep asking follow-ups until the user is satisfied.

Areas to explore (adapt based on the domain):

- **Domain scope and boundaries** — what this author covers and what it doesn't
- **Writing style and tone** — formal/informal, terse/verbose, narrative/reference
- **Structural conventions** — how to organize sections, heading levels, document structure
- **Quality standards and completeness criteria** — what makes an artifact "done"
- **Audience assumptions** — who reads these, what they already know
- **Relationship conventions** — when to use depends-on vs relates-to, how to discover connections
- **Tag conventions** — what tags exist, when to create new ones
- **Examples** — what "good" and "bad" artifacts look like in this domain
- **Constraints and rules** — anything the author must always or never do

Continue asking until you have a fine-grained understanding. The user drives the depth — they can stop at any point by saying they're done.

## Step 6: Construct agent file

Synthesize all elicited knowledge into a Claude Code agent file. The file includes the author persona AND the full write workflow so the agent can operate independently.

Use this structure:

````markdown
---
name: author-<name>-<tenant>
description: <what this author agent does> for the <tenant> knowledge base
model: inherit
tools: Bash, Read, Write, Glob, Grep
---

# <Author Name>

<Elicited persona: style, tone, conventions, quality standards, domain scope, audience, constraints — everything from the elicitation session>

---

# Knowledge Artifact Writing

You create and update knowledge artifacts in the **<tenant>** Pramana knowledge base.
Source directory: `<source-dir>`

## Workflow

### 1. Orient
```bash
pramana list --tenant <tenant>
```

### 2. Research
```bash
pramana search "<topic>" --tenant <tenant>
pramana get <slug>#<section> --tenant <tenant>
```

### 3. Write
Create the artifact following your persona's style and these format rules:

**Frontmatter:**
```yaml
---
slug: kebab-case-slug
title: Human Readable Title
summary: "One-line description of this concept for search discovery"
aliases: [alternative-name, abbreviation, synonym]
tags: [tag1, tag2]
relationships:
  depends-on: [slug1]
  relates-to: [slug2]
---
```
- `summary` (optional but encouraged): one-line description, indexed for search
- `aliases` (optional): alternative names, synonyms, abbreviations — indexed for search so vocabulary gaps are bridged at the source

**Body:** H1 title, H2 major sections, H3 subsections. No H4+.
**Wikilinks:** `[[slug]]` for relates-to, `[[depends-on::slug]]` for dependencies.

### 4. Save and verify
Save to `<source-dir>/<slug>.md`, then:
```bash
pramana reload --tenant <tenant>
pramana get <slug> --tenant <tenant>
pramana traverse <slug> --depth 1 --tenant <tenant>
```

### Quality checklist
- Slug is kebab-case and unique
- Summary is present (one-line description for search)
- Aliases cover common synonyms, abbreviations, and legacy names
- Tags follow existing conventions
- All relationships point to existing artifacts
- Sections use H2/H3 properly
- Content matches your persona's quality standards
- Relationship keys are valid (`depends-on` | `relates-to`)
````

## Step 7: Save

Ask the user where to place the agent:
- **Project-level** (recommended): `.claude/agents/author-<name>-<tenant>.md`
- **Global**: `~/.claude/agents/author-<name>-<tenant>.md`

```bash
mkdir -p .claude/agents
```
or
```bash
mkdir -p ~/.claude/agents
```

Write the agent definition file to disk.

Confirm to the user:
```
Author agent "author-<name>-<tenant>" created in .claude/agents/.
Invoke it with: @"author-<name>-<tenant> (agent)" <topic>
```
