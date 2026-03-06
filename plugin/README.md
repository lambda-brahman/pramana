# Pramana Plugin for Claude

Query, author, and manage knowledge graphs built from Markdown files directly from Claude.

## Setup

1. Start the Pramana daemon:

```bash
# Single knowledge base
pramana serve --source ./your-knowledge-dir --port 3000

# Multiple knowledge bases (multi-tenant)
pramana serve --source ./law:law --source ./music:music --port 3000
```

2. Add the plugin to Claude:

```bash
claude --plugin-dir ./plugin
```

## Skills

### /pramana:setup

Start and configure a Pramana daemon:

```
/pramana:setup ./my-knowledge-dir
/pramana:setup ./law ./music
```

The skill guides Claude through:
- Starting the daemon with proper source configuration
- Parsing ingestion reports
- Diagnosing and fixing failed files (YAML issues, missing slugs, etc.)
- Verifying the daemon is serving correctly

### /pramana:query

Semantically query your knowledge base:

```
/pramana:query "how does the parser work?"
/pramana:query "what are the system invariants?"
/pramana:query "show me the dependency chain from order"
```

The skill teaches Claude to query your knowledge base efficiently — starting with discovery, drilling into specific sections, and following relationship chains as needed.

For multi-tenant setups, specify the tenant:
```
/pramana:query law "what is negligence?"
/pramana:query music "explain jazz harmony"
```

### /pramana:author

Create or update knowledge artifacts:

```
/pramana:author "tort liability"
/pramana:author law "tort liability"
```

The skill guides Claude through:
1. Checking for an author profile (`_meta/author.md`)
2. Eliciting a profile if missing (domain, principles, style, completeness criteria)
3. Researching connections to existing artifacts
4. Drafting with proper frontmatter, sections, and wikilinks
5. Saving and reloading the knowledge base

## How it works

All skills guide Claude through structured workflows using CLI commands:

1. **Setup** — Start daemon, parse ingestion, fix errors
2. **Query** — Orient → Discover → Focus → Connect → Synthesize
3. **Author** — Profile → Research → Draft → Save → Verify

Claude uses `pramana get slug#section` for token-efficient reads rather than fetching entire artifacts.

## Architecture

The plugin connects to a running Pramana daemon via CLI commands. No MCP server or custom protocol required — just Bash tool calls.

```
Claude ──skill──▶ pramana CLI ──HTTP──▶ pramana daemon
```

Multi-tenant routing uses the `--tenant` flag:
```
Claude ──skill──▶ pramana get order --tenant commerce ──▶ pramana daemon (commerce tenant)
```

If no daemon is running, commands fall back to standalone mode (rebuilds from source on each invocation).
