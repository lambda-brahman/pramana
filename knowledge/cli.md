---
slug: cli
title: CLI
tags: [cli, module]
relationships:
  depends-on: [pramana, engine, api, storage, multi-tenant]
---

# CLI

## Specification

```
pramana <command> --source <dir>[:name] [options]
```

Entry point. Dispatches commands after a fixed lifecycle.

### Lifecycle

#### Standalone mode

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

#### Serve mode (daemon)

```
1. parse args → (sources[], port)
2. tm = new TenantManager()
3. for each source: tm.mount({ name, sourceDir })
4. print ingestion summary per tenant to stderr
5. createServer({ port, tenantManager: tm })
6. print listening message to stdout
```

#### Client mode

```
1. parse args → (command, options)
2. resolve port (flag > env > default)
3. check if daemon reachable (GET /v1/list, 1s timeout)
4. if reachable: build URL with optional --tenant prefix, fetch, print
5. if not reachable: fall back to standalone mode
```

### Commands

| Command | Dispatch | Options |
|---------|----------|---------|
| `serve` | `createServer({ port, tenantManager })` | `--port <n>`, `--source <dir>[:name]` (repeatable) |
| `get <slug>` | `reader.get(slug)` | `--tenant <name>` |
| `search <query>` | `reader.search(query)` | `--tenant <name>` |
| `traverse <slug>` | `reader.traverse(slug, type?, depth?)` | `--type <t>`, `--depth <n>`, `--tenant <name>` |
| `list` | `reader.list(filter?)` | `--tags <t1,t2>`, `--tenant <name>` |
| `reload` | `POST /v1/:tenant/reload` | `--tenant <name>` (daemon only) |

### Multi-source syntax

The `--source` flag accepts `path:name` notation for multi-tenant serve:

```bash
pramana serve --source ./law:law --source ./music:music
```

The last `:` separates path from name. Without `:`, the directory basename is used:

```bash
pramana serve --source ./knowledge    # tenant name = "knowledge"
```

### Tenant routing

The `--tenant` flag routes client commands to a specific tenant:

```bash
pramana get order --tenant commerce
pramana list --tenant notes
pramana reload --tenant commerce
```

Without `--tenant`, commands go to the default tenant (first mounted).

### IO contract

| Stream | Content | Format |
|--------|---------|--------|
| stdout | Query results | JSON (pretty-printed) |
| stderr | Ingestion summary, errors | Human-readable text |
| exit 0 | Success | — |
| exit 1 | Error (missing args, build failure, query error) | — |

### Ingestion summary format

Single tenant:
```
Ingested {succeeded}/{total} files
```

Multi-tenant:
```
[tenant-name] Ingested {succeeded}/{total} files
[tenant-name] Ingested {succeeded}/{total} files (n failed)
  ✗ {file}: {error.message}
```

## Laws

**C1. Hermetic execution**: every standalone invocation rebuilds from source. No persistent state between runs.

**C2. Stdout is machine-readable**: only JSON goes to stdout. `pramana list --source kb | jq '.[]'` must work.

**C3. Stderr is human-readable**: diagnostics, summaries, and errors go to stderr. Never pollutes stdout.

**C4. Non-zero exit on error**: scripts can check `$?`.

**C5. Tenant routing**: `--tenant` flag maps to URL prefix `/v1/{tenant}/...` in client mode. Without it, requests use `/v1/...` (default tenant).

## Design rationale

**Why rebuild every time?** No stale data, no cache invalidation, no schema migration. The cost (~100ms for hundreds of files) is acceptable for interactive and scripted use.

**Why stderr for diagnostics?** Unix convention. Allows piping stdout to downstream tools without filtering noise.

**Why reload is daemon-only?** Standalone mode rebuilds on every invocation. Reload is only meaningful for a persistent daemon process.
