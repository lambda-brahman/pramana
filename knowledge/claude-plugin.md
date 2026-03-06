---
slug: claude-plugin
title: Claude Plugin
tags: [plugin, module]
relationships:
  depends-on: [cli, api, pramana, multi-tenant]
---

# Claude Plugin

Integration layer that connects Pramana to Claude via a daemon + CLI client + skills architecture.

## Architecture

```
pramana serve --source ./law:law --source ./music:music --port 3000
    ▲
    │ HTTP (tenant-scoped)
    │
pramana get negligence --tenant law        # CLI client with tenant routing
pramana search "jazz" --tenant music       # connects to running daemon
    ▲
    │ Bash
    │
/pramana:setup ./law-kb                    # start daemon, report ingestion
/pramana:query law "negligence?"           # semantic query with tenant
/pramana:author law "tort liability"       # create artifact, auto-profile
```

Three layers:
1. **Daemon**: `pramana serve` — persistent process, supports multi-tenant
2. **CLI client mode**: commands detect running server → HTTP client; fallback to rebuild
3. **Skills**: teach Claude how to set up, query, and author knowledge

## Skills

### /pramana:setup

Guides Claude through daemon startup:
- Start with single or multiple sources
- Parse ingestion report from stderr
- Diagnose failed files (YAML issues, missing slug, etc.)
- Verify with `pramana list`

### /pramana:query

Teaches Claude semantic querying:
- Orient → Discover → Focus → Connect → Synthesize
- Token management (section reads over full artifacts)
- Multi-tenant awareness (discover tenants, route queries)

### /pramana:author

Guides Claude through artifact creation:
- Check for author profile (`_meta/author.md`)
- Elicit profile if missing (domain-agnostic questions)
- Research connections to existing artifacts
- Draft with proper frontmatter, sections, wikilinks
- Save and reload

## Author profile

Each tenant can have an author profile at `_meta/author.md` (slug: `_meta-author`). This captures:
- Domain scope
- Core principles
- Writing style preferences
- Completeness criteria
- Target audience

The profile is elicited on first `/pramana:author` invocation and used to guide all subsequent artifact creation.

## Server discovery

Port resolution order:
1. `--port <n>` flag (explicit)
2. `PRAMANA_PORT` environment variable
3. Default: `3000`

Detection: `GET /v1/list` with 1-second timeout. If reachable → HTTP client mode. If not → fallback to `buildEngine()` (standalone mode, preserves [[cli]] law C1).

## HTTP client mapping

| CLI command | HTTP request |
|-------------|-------------|
| `get <slug> --tenant t` | `GET /v1/t/get/{slug}` |
| `get <slug>#<section>` | `GET /v1/get/{slug}/{section}` |
| `search <query> --tenant t` | `GET /v1/t/search?q={query}` |
| `traverse <slug> --tenant t` | `GET /v1/t/traverse/{slug}?type={t}&depth={d}` |
| `list --tenant t` | `GET /v1/t/list?tags={tags}` |
| `reload --tenant t` | `POST /v1/t/reload` |

Without `--tenant`, requests go to `/v1/...` (default tenant).

The HTTP [[api]] already returns exactly what the [[cli]] outputs — JSON to stdout. The client simply forwards the response body.

## Error mapping

| HTTP status | CLI behavior |
|-------------|-------------|
| 200 | Print response body to stdout, exit 0 |
| 400 | Print error message to stderr, exit 1 |
| 404 | Print "Not found" to stderr, exit 1 |
| 500 | Print error message to stderr, exit 1 |
| Connection refused | Fall back to standalone mode |

## Standalone flag

`--standalone` forces rebuild mode, skipping server detection entirely. Useful for scripts that must not depend on a running daemon.

```
pramana get order --source ./knowledge --standalone
```

## Plugin structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json          # manifest
└── skills/
    ├── query/
    │   └── SKILL.md         # semantic query guidance
    ├── setup/
    │   └── SKILL.md         # daemon setup guidance
    └── author/
        └── SKILL.md         # artifact authoring guidance
```

## Laws

**CP1. Daemon transparency**: CLI output is identical whether served by daemon or rebuilt standalone. The client mode is an optimization, not a behavioral change.

**CP2. Graceful degradation**: if no daemon is running and `--source` is provided, fall back to standalone mode silently. If neither is available, exit with error.

**CP3. Skill as semantic layer**: the skill prompts shape Claude's behavior. Setup teaches daemon management, query teaches token-efficient retrieval, author teaches knowledge creation with profile-guided quality.

**CP4. Zero coupling**: the plugin uses only Bash tool calls to invoke CLI commands. No MCP server, no custom protocol, no SDK dependency.
