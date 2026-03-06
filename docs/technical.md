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
pramana get <slug> --source <dir> [--tenant <name>]
pramana search <query> --source <dir> [--tenant <name>]
pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>] [--tenant <name>]
pramana list --source <dir> [--tags <tag1,tag2>] [--tenant <name>]
pramana reload [--tenant <name>]
pramana version [--check]
pramana upgrade
```

### Client mode

When a Pramana daemon is running, CLI commands automatically connect to it via HTTP instead of rebuilding the knowledge graph:

```bash
# Start the daemon
pramana serve --source ./knowledge --port 5111

# These connect to the daemon (no --source needed)
pramana get order
pramana search "parser"
pramana list --tags concept
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
GET /v1/version                — Returns CLI/daemon version
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

## Example Knowledge Bases

Pramana includes three example knowledge bases in the `examples/` directory. Each demonstrates how to structure artifacts, use relationships, and build dependency chains for a different domain.

### Law — Tort Law Basics

Four artifacts covering the elements of negligence in tort law. Designed for legal professionals, paralegals, and law students.

| Artifact | Tags | Relationships |
|----------|------|---------------|
| `negligence` | concept, tort | depends-on: duty-of-care, breach, causation |
| `duty-of-care` | concept, tort | relates-to: negligence |
| `breach` | concept, tort | depends-on: duty-of-care |
| `causation` | concept, tort | depends-on: breach |

**Dependency chain:** Negligence depends on all three elements. Causation depends on breach, which depends on duty-of-care. Asking "what is negligence?" traverses the full chain.

```
/pramana:setup ./examples/law
/pramana:query "what is negligence?"
/pramana:query "what does negligence depend on?"
```

### Recipes — Cooking Techniques & Dishes

Four artifacts showing how cooking techniques build on each other. Universally relatable, great for demos.

| Artifact | Tags | Relationships |
|----------|------|---------------|
| `roux` | technique, base | — |
| `bechamel` | sauce, french | depends-on: roux |
| `lasagna` | dish, italian | depends-on: bechamel |
| `mac-and-cheese` | dish, comfort | depends-on: bechamel, roux |

**Dependency chain:** Roux is the foundation. Bechamel depends on roux. Both dishes depend on bechamel. Asking "how do I make lasagna?" traverses down to the roux technique.

```
/pramana:setup ./examples/recipes
/pramana:query "how do I make lasagna from scratch?"
/pramana:query "what do I need to know before making bechamel?"
```

### Software Architecture — Microservices

Four artifacts modeling a microservice system. Designed for developers and engineering teams.

| Artifact | Tags | Relationships |
|----------|------|---------------|
| `api-gateway` | service, infrastructure | depends-on: auth-service, rate-limiter |
| `auth-service` | service, security | relates-to: user-service |
| `user-service` | service, core | relates-to: auth-service |
| `rate-limiter` | service, infrastructure | relates-to: api-gateway |

**Dependency chain:** API gateway depends on auth and rate limiting. Auth relates to user service. Asking "what happens when a request hits the API?" traverses from gateway through auth and rate limiting.

```
/pramana:setup ./examples/architecture
/pramana:query "what happens when a request hits the API gateway?"
/pramana:query "what services does the API gateway depend on?"
```

### Verifying examples manually

```bash
pramana serve --source ./examples/law --port 4000 &
curl http://localhost:4000/v1/list | jq length                                    # 4
curl http://localhost:4000/v1/get/negligence | jq .slug                           # "negligence"
curl "http://localhost:4000/v1/traverse/negligence?type=depends-on" | jq '.[].slug'  # duty-of-care, breach, causation
kill %1
```

## Development

```bash
bun install
bun test
bun run typecheck
```
