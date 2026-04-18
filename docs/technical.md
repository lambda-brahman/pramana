# Technical Reference

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh -s v0.2.0
```

Custom install directory:

```bash
PRAMANA_INSTALL=~/.local/bin curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

Or download a binary directly from [Releases](https://github.com/lambda-brahman/pramana/releases).

## Document format

Each Markdown file needs YAML frontmatter with at least a `slug`:

```markdown
---
slug: my-topic
title: My Topic
tags: [concept, architecture]
relates-to: [other-topic, another-topic]
---

# My Topic

Content with [[wikilink]] references to other documents.
```

Relationships can be declared in frontmatter (as typed relations) or inline via `[[wikilinks]]`.

### Relationship types

- **depends-on**: Structural dependency. A depends-on B means A cannot function without B.
- **relates-to**: Associative link. A relates-to B means they share a conceptual connection.

### Wikilink syntax

```markdown
[[target]]                  → relates-to (default)
[[depends-on::target]]      → depends-on
[[relates-to::target]]      → relates-to (explicit)
```

## CLI

```
pramana serve --source <dir>[:name] [--source <dir>[:name] ...] [--port 5111]
pramana get <slug> --source <dir> --tenant <name>
pramana search <query> --source <dir> --tenant <name>
pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>] --tenant <name>
pramana list --source <dir> [--tags <tag1,tag2>] --tenant <name>
pramana reload --tenant <name>
pramana version [--check]
pramana upgrade
```

### Client mode

When a Pramana daemon is running, CLI commands automatically connect to it via HTTP instead of rebuilding the knowledge graph:

```bash
# Start the daemon
pramana serve --source ./knowledge:kb --port 5111

# These connect to the daemon (no --source needed, --tenant required)
pramana get order --tenant kb
pramana search "parser" --tenant kb
pramana list --tags concept --tenant kb
```

Port resolution: `--port` flag > `PRAMANA_PORT` env var > default `5111`.

If no daemon is reachable, commands fall back to standalone mode (requires `--source`).

Use `--standalone` to force rebuild mode even when a daemon is running:

```bash
pramana get order --source ./knowledge --standalone
```

### Multi-tenant serve

Serve multiple knowledge bases from a single daemon:

```bash
pramana serve --source ./law:law --source ./music:music --port 5111
```

The `path:name` notation assigns a tenant name. Without `:`, the directory basename is used.

Query specific tenants with `--tenant` (required):

```bash
pramana get negligence --tenant law
pramana search "jazz" --tenant music
pramana list --tenant law
```

### Reload

Re-ingest a tenant without restarting the daemon:

```bash
pramana reload --tenant law
```

## HTTP API

Start the server with `pramana serve --source <dir>:name`, then:

```
GET /v1/version                         — Returns CLI/daemon version
GET /v1/tenants                         — List all tenants
GET /v1/:tenant/get/:slug               — Get artifact by slug
GET /v1/:tenant/get/:slug/:section      — Get artifact focused on a section
GET /v1/:tenant/search?q=<query>        — Full-text search
GET /v1/:tenant/traverse/:slug?type=<rel>&depth=<n> — Graph traversal
GET /v1/:tenant/list?tags=<t1,t2>       — List artifacts, optionally filtered by tags
POST /v1/:tenant/reload                 — Rebuild tenant
```

All endpoints return JSON with `Content-Type: application/json` and CORS headers.

Unscoped paths (e.g. `GET /v1/list`) return a 400 error listing available tenant names.

## Author Agents

Authors are agent personas that define how knowledge artifacts should be written. Each author captures domain expertise, writing style, structural conventions, and quality standards.

### `_meta/` directory convention

The `_meta/` directory inside a knowledge source contains skill-layer metadata — files that are used by the plugin skills but are **not** indexed as domain knowledge by the engine. The builder explicitly skips `_meta/` during ingestion.

### Author file convention

Authors are stored as `_meta/author-<name>.md` in the knowledge source directory. Each file is a Claude-compatible agent definition:

```markdown
---
name: author-<name>
description: <what this author agent does>
model: inherit
---

<system prompt defining the author's persona, style, and standards>
```

The YAML frontmatter provides agent metadata. The markdown body is the agent's system prompt — its complete identity and instructions for artifact creation.

### How authors work

- **`create-author`** builds an author agent through interactive elicitation. The user answers open-ended questions about their domain, style, and standards. Claude synthesizes the answers into an agent definition file. This skill has `disable-model-invocation: true` — only users can invoke it.
- **`author`** loads a named author as a sub-agent persona. It reads the author's agent file from disk, adopts the persona, and creates artifacts according to its standards. This skill is model-invocable — agents like OpenClaw can use it autonomously.

### Discovery

Authors are discovered by reading the source directory directly (`ls _meta/author-*.md`), not via the Pramana API. They are source files, not indexed artifacts.

### Multiple authors

Each tenant can have multiple authors for different purposes:
- `_meta/author-api-docs.md` — API reference documentation
- `_meta/author-tutorial.md` — step-by-step tutorials
- `_meta/author-architecture.md` — architecture decision records

There is no default author. The `--author` flag selects which one to use. If omitted, the user is asked to pick from available authors.

### Safety gate

The `author` skill requires an author to exist before it can create artifacts. An admin must first interactively build one via `create-author`. This prevents agents from creating artifacts without quality standards being defined.

## Development

Rust workspace; stable toolchain.

```bash
cargo build --release -p pramana-cli
cargo test --workspace
cargo fmt --check
cargo clippy --workspace -- -D warnings
```
