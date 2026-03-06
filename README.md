# Pramana

**Give Claude your domain knowledge.**

Pramana turns a directory of Markdown files into a queryable knowledge graph that Claude can search, traverse, and build upon. Instead of pasting context into every conversation, encode your expertise once — Claude retrieves exactly what it needs.

> The reference implementation of the semantic layer described in [Knowledge Engineering: The Future of AI-Assisted Software Engineering](https://knowledgeengineering.substack.com/p/knowledge-engineering-the-future).

## Quick start

### 1. Install Pramana

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

### 2. Install the Claude plugin

```
/plugin marketplace add lambda-brahman/pramana
/plugin install pramana@lambda-brahman
```

### 3. Write your first artifact

Create a Markdown file in a directory (e.g., `./knowledge/`):

```markdown
---
slug: onboarding-flow
title: Onboarding Flow
tags: [process, user-facing]
relates-to: [user-account, email-verification]
---

# Onboarding Flow

New users go through a three-step onboarding...

## Steps

1. Create account via [[depends-on::user-account]]
2. Verify email via [[email-verification]]
3. Complete profile
```

### 4. Start the daemon and ask Claude

```bash
pramana serve --source ./knowledge
```

```
/pramana:query "how does onboarding work?"
```

Claude will search your knowledge base, read the relevant sections, follow the relationship links, and give you an answer grounded in your domain knowledge.

## What can Claude do with Pramana?

### `/pramana:setup` — Set up your knowledge base

Claude starts the daemon, checks ingestion, and helps fix any broken files:

```
/pramana:setup ./my-knowledge-dir
```

### `/pramana:query` — Ask questions about your domain

Claude searches, reads focused sections, and follows dependency chains to answer:

```
/pramana:query "what are the pricing rules for enterprise customers?"
/pramana:query "show me everything that depends on the auth module"
```

### `/pramana:author` — Create new knowledge artifacts

Claude elicits your authoring preferences (style, principles, completeness criteria), then drafts new artifacts that fit your knowledge base:

```
/pramana:author "API rate limiting policy"
```

On first use, Claude asks you five questions to build an author profile — so every artifact it creates matches your standards.

## Multi-tenant: multiple knowledge bases

Serve several knowledge domains from one daemon:

```bash
pramana serve --source ./law:law --source ./engineering:eng --port 3000
```

Then query specific domains:

```
/pramana:query law "what is negligence?"
/pramana:query eng "how does the build pipeline work?"
```

## How it works

```
Your Markdown files
      ↓ parsed at startup
In-memory knowledge graph (SQLite)
      ↓ four primitives
get · search · traverse · list
      ↓ via CLI + HTTP
Claude skills (setup · query · author)
```

- **get** — point lookup by slug, with optional section focus
- **search** — full-text search across all artifacts
- **traverse** — follow dependency chains through the graph
- **list** — enumerate artifacts, filtered by tags

Artifacts link to each other through two relationship types:
- **depends-on** — structural: A cannot function without B
- **relates-to** — associative: A and B are connected

## Install options

```bash
# Latest
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh

# Specific version
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh -s v0.2.0

# Or download from GitHub Releases
```

See [Releases](https://github.com/lambda-brahman/pramana/releases) for binaries.

## Documentation

- [Technical reference](docs/technical.md) — CLI commands, HTTP API, document format, multi-tenant details
- [Plugin guide](plugin/README.md) — Skill details, architecture, multi-tenant querying

## Development

```bash
bun install
bun test          # 113 tests
bun run typecheck
```

## License

Private
