---
slug: cli
title: CLI
tags: [module, cli]
relationships:
  part-of: pramana
  uses: [builder, reader, api]
---

# CLI

The command-line interface and entry point for [[pramana]]. Parses arguments, builds the knowledge graph, then executes the requested command.

## Commands

- `pramana serve --source <dir> [--port 3000]` — start the [[api]] server
- `pramana get <slug> --source <dir>` — print artifact as JSON
- `pramana search <query> --source <dir>` — print search results as JSON
- `pramana traverse <slug> --source <dir> [--type <rel>] [--depth <n>]` — print traversal results
- `pramana list --source <dir> [--tags <t1,t2>]` — print all matching artifacts

## Startup

Every command follows the same startup sequence:

1. Initialize [[sqlite-storage]] with `:memory:`
2. Run the [[builder]] against `--source` directory
3. Print ingestion summary to stderr
4. Create a [[reader]] and execute the command

## Output

All query commands print JSON to stdout. Diagnostic messages (ingestion summary, errors) go to stderr.
