---
slug: multi-tenant
title: Multi-Tenant
tags: [engine, module]
relationships:
  depends-on: [engine, api, cli, pramana]
  relates-to: [claude-plugin]
---

# Multi-Tenant

A single Pramana daemon can serve multiple knowledge bases simultaneously. Each knowledge base is a **tenant** — an isolated namespace with its own storage, reader, and artifact set.

## Source parsing

The `--source` flag accepts `path:name` notation:

```
--source ./law:law          → path="./law", name="law"
--source ./music:music      → path="./music", name="music"
--source ./knowledge        → path="./knowledge", name="knowledge" (basename)
```

The last `:` separates path from name. If no `:` is present, the directory basename is used as the tenant name.

Multiple `--source` flags mount multiple tenants:

```bash
pramana serve --source ./law:law --source ./music:music --port 3000
```

## Tenant naming

Names must match: `/^[a-z][a-z0-9-]*$/`

- Start with a lowercase letter
- Contain only lowercase letters, digits, hyphens
- No underscores, spaces, or uppercase

### Reserved names

These names are reserved for API routes and cannot be used as tenant names:

`get`, `search`, `traverse`, `list`, `tenants`, `reload`

## Routing disambiguation

The [[api]] uses a prefix-based routing strategy:

```
GET /v1/:tenant/get/:slug     ← tenant-scoped (if :tenant is a known tenant)
GET /v1/get/:slug              ← default tenant fallthrough
```

**Algorithm**: If the first path segment after `/v1/` matches a mounted tenant name, route to that tenant. Otherwise, fall through to the default tenant.

The first mounted tenant becomes the default. This preserves backward compatibility — a single-source daemon behaves identically to pre-multi-tenant behavior.

## Reload semantics

```
POST /v1/:tenant/reload    → rebuild specific tenant
POST /v1/reload             → rebuild default tenant
```

Reload is atomic: a new storage + builder + reader are created from the tenant's source directory. Only on success is the old state swapped out. During rebuild, the old reader continues serving queries.

If rebuild fails (e.g., source directory deleted), the old state is preserved and the error is returned.

## TenantManager

The [[engine]] is extended with a TenantManager class:

```
TenantManager
  mount(config)           → validate name, build storage+reader, store in Map
  reload(name)            → atomic rebuild with swap-on-success
  getReader(name)         → lookup or error
  getDefaultReader()      → first tenant's reader or error
  defaultTenantName()     → string | null
  listTenants()           → [{ name, sourceDir, artifactCount }]
  hasTenant(name)         → boolean
  close()                 → close all storages
```

Each tenant gets its own in-memory SQLite database, Builder, and Reader. There is no shared state between tenants.

## Backward compatibility

Single-source mode continues to work unchanged:

```bash
pramana serve --source ./knowledge
```

This mounts a single tenant named `knowledge` (the basename). All existing routes work because the default tenant handles `/v1/...` requests that don't match a tenant prefix.

The `{ port, reader }` server option still works for direct Reader injection (used in tests).

## Laws

**MT1. Tenant isolation**: artifacts, relationships, and search indexes are fully separated per tenant. A query to tenant A never returns results from tenant B.

**MT2. Atomic reload**: reload either fully succeeds (new state replaces old) or fully fails (old state preserved). No partial state.

**MT3. Default fallthrough**: requests without a tenant prefix route to the default (first-mounted) tenant, preserving backward compatibility with single-tenant deployments.

**MT4. Name safety**: tenant names are validated against reserved words and a strict regex to prevent routing collisions with API operation paths.
