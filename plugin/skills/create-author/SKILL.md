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

Scan the `_meta/` directory in the knowledge source for existing author agents:

```bash
ls <source-dir>/_meta/author-*.md 2>/dev/null
```

Show what already exists so the user has context.

## Step 4: Check target author

Read the target author file directly from disk:

```bash
cat <source-dir>/_meta/author-<name>.md
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

Synthesize all elicited knowledge into a Claude-compatible agent definition file. The file follows Claude's sub-agent format:

```markdown
---
name: author-<name>
description: <what this author agent does, when to use it>
model: inherit
---

<system prompt: the complete author persona, style guide, conventions,
 quality standards — everything elicited from the user>
```

The YAML frontmatter uses the same fields as Claude Code agent files (`name`, `description`, `model`). The markdown body is the agent's system prompt — its identity and instructions. Keep it open-ended and as rich as the elicitation warrants.

## Step 7: Save

Save the file to `<source-dir>/_meta/author-<name>.md`.

```bash
mkdir -p <source-dir>/_meta
```

Write the agent definition file to disk. No reload is needed — authors are not indexed by the engine. They are skill-layer metadata read directly from the source directory.

Confirm to the user:
```
Author agent "author-<name>" saved to <source-dir>/_meta/author-<name>.md
Use it with: /pramana:author <tenant> --author <name> <topic>
```
