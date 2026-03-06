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
pramana serve --source <dir>[:name] [--source <dir>[:name] ...] [--port 3000]
pramana get <slug> --source <dir> [--tenant <name>]
pramana search <query> --source <dir> [--tenant <name>]
pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>] [--tenant <name>]
pramana list --source <dir> [--tags <tag1,tag2>] [--tenant <name>]
pramana reload [--tenant <name>]
```

### Client mode

When a Pramana daemon is running, CLI commands automatically connect to it via HTTP instead of rebuilding the knowledge graph:

```bash
# Start the daemon
pramana serve --source ./knowledge --port 3000

# These connect to the daemon (no --source needed)
pramana get order
pramana search "parser"
pramana list --tags concept
```

Port resolution: `--port` flag > `PRAMANA_PORT` env var > default `3000`.

If no daemon is reachable, commands fall back to standalone mode (requires `--source`).

Use `--standalone` to force rebuild mode even when a daemon is running:

```bash
pramana get order --source ./knowledge --standalone
```

### Multi-tenant serve

Serve multiple knowledge bases from a single daemon:

```bash
pramana serve --source ./law:law --source ./music:music --port 3000
```

The `path:name` notation assigns a tenant name. Without `:`, the directory basename is used.

Query specific tenants with `--tenant`:

```bash
pramana get negligence --tenant law
pramana search "jazz" --tenant music
pramana list --tenant law
```

Without `--tenant`, the default tenant (first mounted) is used.

### Reload

Re-ingest a tenant without restarting the daemon:

```bash
pramana reload --tenant law
pramana reload                    # reloads default tenant
```

## HTTP API

Start the server with `pramana serve --source <dir>`, then:

```
GET /v1/get/:slug              — Get artifact by slug
GET /v1/get/:slug/:section     — Get artifact focused on a section
GET /v1/search?q=<query>       — Full-text search
GET /v1/traverse/:slug?type=<rel>&depth=<n> — Graph traversal
GET /v1/list?tags=<t1,t2>      — List artifacts, optionally filtered by tags
```

### Multi-tenant endpoints

```
GET /v1/tenants                         — List all tenants
GET /v1/:tenant/get/:slug               — Tenant-scoped get
GET /v1/:tenant/search?q=<query>        — Tenant-scoped search
GET /v1/:tenant/traverse/:slug          — Tenant-scoped traverse
GET /v1/:tenant/list                    — Tenant-scoped list
POST /v1/:tenant/reload                 — Rebuild tenant
POST /v1/reload                         — Rebuild default tenant
```

All endpoints return JSON with `Content-Type: application/json` and CORS headers.

## Development

```bash
bun install
bun test
bun run typecheck
```
