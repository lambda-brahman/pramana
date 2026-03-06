---
slug: cli
title: CLI
tags: [cli, module]
relationships:
  depends-on: [pramana, engine, api, storage]
---

# CLI

## Specification

```
pramana <command> --source <dir> [options]
```

Entry point. Dispatches commands after a fixed lifecycle.

### Lifecycle

Every invocation follows:

```
1. parse args → (command, sourceDir, options)
2. storage = new StoragePlugin(":memory:")
3. storage.initialize()
4. builder = new Builder(storage)
5. report = builder.build(sourceDir)
6. print ingestion summary to stderr
7. reader = new Reader(storage, storage)
8. dispatch(command, reader, options) → result
9. print result as JSON to stdout (or start server)
```

### Commands

| Command | Dispatch | Options |
|---------|----------|---------|
| `serve` | `createServer({ port, reader })` | `--port <n>` (default 3000) |
| `get <slug>` | `reader.get(slug)` | — |
| `search <query>` | `reader.search(query)` | — |
| `traverse <slug>` | `reader.traverse(slug, type?, depth?)` | `--type <t>`, `--depth <n>` (default 1) |
| `list` | `reader.list(filter?)` | `--tags <t1,t2>` |

### IO contract

| Stream | Content | Format |
|--------|---------|--------|
| stdout | Query results | JSON (pretty-printed) |
| stderr | Ingestion summary, errors | Human-readable text |
| exit 0 | Success | — |
| exit 1 | Error (missing args, build failure, query error) | — |

### Ingestion summary format

```
Ingested {succeeded}/{total} files
```

If failures exist:
```
Ingested {succeeded}/{total} files ({failed.length} failed)
  ✗ {file}: {error.message}
  ✗ {file}: {error.message}
```

## Laws

**C1. Hermetic execution**: every invocation rebuilds from source. No persistent state between runs.

**C2. Stdout is machine-readable**: only JSON goes to stdout. `pramana list --source kb | jq '.[]'` must work.

**C3. Stderr is human-readable**: diagnostics, summaries, and errors go to stderr. Never pollutes stdout.

**C4. Non-zero exit on error**: scripts can check `$?`.

## Design rationale

**Why rebuild every time?** No stale data, no cache invalidation, no schema migration. The cost (~100ms for hundreds of files) is acceptable for interactive and scripted use.

**Why stderr for diagnostics?** Unix convention. Allows piping stdout to downstream tools without filtering noise.
