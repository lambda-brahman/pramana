---
name: query
description: Look up domain knowledge, definitions, rules, dependencies, and relationships from the user's Pramana knowledge base. Use whenever the conversation involves domain-specific concepts, the user asks about their domain, or you need context that may be captured in their knowledge base.
args: query
user_invocable: true
---

# Pramana Knowledge Query

You have access to a Pramana knowledge base — a graph of interconnected Markdown artifacts. Use the CLI commands below to answer the user's question.

## Prerequisites

A Pramana daemon should be running (`pramana serve --source <dir>`). If not, commands will fall back to standalone mode (requires `--source`).

## Commands

```bash
pramana list [--tenant <name>]                    # discover what's in the KB
pramana list --tags concept [--tenant <name>]     # filter by tag
pramana search "<query>" [--tenant <name>]        # full-text search for discovery
pramana get <slug> [--tenant <name>]              # deep dive into a specific artifact
pramana get <slug>#<section> [--tenant <name>]    # focused section read (token efficient)
pramana traverse <slug> --type depends-on --depth 2 [--tenant <name>]  # follow dependency chains
```

## Multi-tenant awareness

The daemon may serve multiple knowledge bases (tenants). To discover available tenants:

```bash
curl http://localhost:${PRAMANA_PORT:-5111}/v1/tenants
```

Or check if the user specifies a tenant in their query. If the user's question mentions a specific domain and multiple tenants exist, ask which tenant to query. If only one tenant exists or the user doesn't specify, use the default tenant (omit `--tenant`).

When working with a specific tenant, always include `--tenant <name>` in every command.

## Querying strategy

Follow this workflow to answer the user's question: **$ARGUMENTS**

### Step 1: Orient

Run `pramana list [--tenant <name>]` to see all artifacts. Scan the slugs and tags to understand the KB's scope.

### Step 2: Discover

Use `pramana search "<relevant terms>" [--tenant <name>]` to find artifacts related to the question. Search returns ranked results — look at the top hits.

### Step 3: Focus

For each relevant artifact, use `pramana get <slug>#<section> [--tenant <name>]` to read specific sections rather than the entire artifact. This is critical for token efficiency.

Only use `pramana get <slug> [--tenant <name>]` (without section) when you need the full picture of an artifact.

### Step 4: Follow connections

If the answer involves relationships between concepts:
- `pramana traverse <slug> --type depends-on [--tenant <name>]` shows structural dependencies
- `pramana traverse <slug> --type relates-to [--tenant <name>]` shows associative connections
- Increase `--depth` to follow chains (default is 1)

### Step 5: Synthesize

Combine information from multiple artifacts into a coherent answer. Reference specific artifacts by slug so the user can explore further.

## Relationship semantics

- **depends-on**: Structural dependency. A depends-on B means A requires B to function. Follow these to understand architecture.
- **relates-to**: Associative link. A relates-to B means they share a conceptual connection. Follow these to broaden understanding.

## Token management rules

1. **Never dump entire artifacts** when a section suffices. Use `get slug#section`.
2. **Start narrow, expand if needed**. Begin with search, then get specific sections, only fetch full artifacts if the section isn't enough.
3. **Use list sparingly** — it returns all artifact metadata. Once you've oriented, switch to targeted gets.
4. **Traverse is expensive** at depth > 2. Use depth 1 first, increase only if needed.
5. **Prefer search over list** for discovery. Search uses full-text indexing; list returns everything.
