# Pramana Plugin for Claude

Give Claude access to your domain knowledge. Write Markdown files, and Claude automatically looks things up when your conversation needs it.

## Install

```
/plugin marketplace add lambda-brahman/pramana
/plugin install pramana@lambda-brahman
```

## Getting started

Install the Pramana CLI, then let Claude handle the rest:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

```
/pramana:setup ./your-knowledge-dir
```

Claude starts Pramana, verifies your files loaded correctly, and reports any issues.

## Skills

This plugin provides four skills with different invocation modes:

### Query — automatic

Claude automatically uses your knowledge base when the conversation involves domain-specific concepts. You don't need to do anything — just talk about your domain and Claude will look things up.

You can also invoke it explicitly:

```
/pramana:query "what are the pricing rules?"
/pramana:query "what depends on the auth module?"
```

For multiple knowledge bases, specify which one:

```
/pramana:query law "what is negligence?"
```

**How it works:** Claude searches your knowledge, reads relevant sections (not whole files), follows relationship chains, and synthesizes an answer. This happens automatically whenever Claude's description matches the conversation context.

### Setup — explicit only

```
/pramana:setup ./my-knowledge-dir
/pramana:setup ./law ./engineering
```

Starts Pramana, checks ingestion, diagnoses broken files (missing slugs, bad YAML, invalid relationships), and verifies everything is running. For multiple directories, Claude helps you name each knowledge base.

This skill is **explicit only** (`disable-model-invocation`) because it starts a background process.

### Create Author — explicit only

```
/pramana:create-author commerce api-docs       # create "api-docs" author
/pramana:create-author commerce tutorial       # create "tutorial" author
```

Builds a named author agent through interactive elicitation. Claude asks open-ended questions to learn your domain expertise, writing style, conventions, and quality standards, then constructs an agent definition file stored in your knowledge directory's `_meta/` folder.

Each author is a distinct agent persona — you can have multiple authors per knowledge base for different purposes (e.g., API reference vs tutorial).

This skill is **explicit only** (`disable-model-invocation`) because it requires interactive conversation with the user.

### Write — automatic

```
/pramana:write commerce --author api-docs billing  # write with "api-docs" agent
/pramana:write commerce billing                    # asks user to pick an author
```

Creates new knowledge artifacts using an existing author agent. The write skill loads the named author's persona and writes artifacts according to its style, conventions, and quality standards.

**Requires an existing author agent** — if none exist, Claude instructs you to create one first via `/pramana:create-author`. This ensures artifacts are always written to defined quality standards.

This skill is **auto-invocable** — Claude can use it autonomously when it determines an artifact should be created.

## Invocation modes

| Skill | Auto-invoked by Claude | User-invocable via `/` | Why |
|-------|----------------------|----------------------|-----|
| query | Yes | Yes | Claude should reach for domain knowledge whenever relevant |
| setup | No | Yes | Starts a daemon — user should ask for this explicitly |
| create-author | No | Yes | Interactive elicitation — user must participate |
| write | Yes | Yes | Autonomous artifact creation (requires existing author) |

## Architecture

Claude uses Bash tool calls to the Pramana CLI, which talks to a background daemon over HTTP:

```
Claude ──skill──> pramana CLI ──HTTP──> pramana daemon
```

The daemon builds a knowledge graph from your Markdown files at startup. If no daemon is running, commands fall back to standalone mode (slower, rebuilds each time).
