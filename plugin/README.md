# Pramana Plugin for Claude

Give Claude access to your domain knowledge — structured as a queryable graph, not raw context dumps.

Pramana implements the semantic layer from [Knowledge Engineering: The Future of AI-Assisted Software Engineering](https://knowledgeengineering.substack.com/p/knowledge-engineering-the-future).

## Install

```
/plugin marketplace add lambda-brahman/pramana
/plugin install pramana@lambda-brahman
```

Or load directly:

```bash
claude --plugin-dir ./plugin
```

## Prerequisites

Install the Pramana CLI and start a daemon:

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh

# Start daemon
pramana serve --source ./your-knowledge-dir --port 3000
```

Or let Claude do it for you:

```
/pramana:setup ./your-knowledge-dir
```

## Skills

### /pramana:setup — Start and configure

```
/pramana:setup ./my-knowledge-dir
/pramana:setup ./law ./music
```

Claude starts the daemon, parses ingestion reports, diagnoses broken files (missing slugs, bad YAML, invalid relationships), and verifies everything is serving correctly.

For multiple knowledge bases:

```
/pramana:setup ./law ./music
```

Claude helps you name tenants and starts a multi-tenant daemon.

### /pramana:query — Ask questions

```
/pramana:query "how does the parser work?"
/pramana:query "what depends on the auth module?"
/pramana:query "show me the pricing rules"
```

Claude follows a structured workflow: orient (list), discover (search), focus (section reads), connect (traverse), synthesize. It reads specific sections instead of dumping entire files — keeping token usage efficient.

For multi-tenant setups:

```
/pramana:query law "what is negligence?"
/pramana:query eng "how does the build pipeline work?"
```

### /pramana:author — Create knowledge artifacts

```
/pramana:author "API rate limiting policy"
/pramana:author law "tort liability"
```

On first use, Claude elicits an author profile:
1. What domain does this KB cover?
2. What core principles guide your thinking?
3. How do you prefer knowledge structured?
4. What makes an artifact "done"?
5. Who is the intended reader?

Then it researches existing connections, drafts with proper frontmatter and wikilinks, saves, and reloads the knowledge base.

## Architecture

No MCP server, no custom protocol — just Bash tool calls to the Pramana CLI:

```
Claude ──skill──▶ pramana CLI ──HTTP──▶ pramana daemon
```

The daemon holds an in-memory SQLite knowledge graph rebuilt from your Markdown files at startup. Four primitives — get, search, traverse, list — are all Claude needs.

Multi-tenant routing uses `--tenant`:

```
Claude ──skill──▶ pramana get order --tenant commerce ──▶ daemon (commerce tenant)
```

If no daemon is running, commands fall back to standalone mode (rebuilds from source each time).
