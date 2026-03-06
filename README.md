# Pramana

A knowledge engine that turns a directory of Markdown files into a queryable knowledge graph. Files are parsed at startup into an in-memory SQLite database, exposing four read-only primitives via CLI and HTTP API.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/sarath-soman/pramana/main/install.sh | sh
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/sarath-soman/pramana/main/install.sh | sh -s v0.1.0
```

Custom install directory:

```bash
PRAMANA_INSTALL=~/.local/bin curl -fsSL https://raw.githubusercontent.com/sarath-soman/pramana/main/install.sh | sh
```

Or download a binary directly from [Releases](https://github.com/sarath-soman/pramana/releases).

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

## CLI

```
pramana serve --source <dir> [--port 3000]
pramana get <slug> --source <dir>
pramana search <query> --source <dir>
pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>]
pramana list --source <dir> [--tags <tag1,tag2>]
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

All endpoints return JSON.

## Development

```bash
bun install
bun test
bun run typecheck
```

## License

Private
