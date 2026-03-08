---
slug: data-source
title: Data Source
tags: [tui, module]
relationships:
  depends-on: [engine, api, result-type, multi-tenant]
---

# Data Source

## Specification

Abstraction over the two query transports: direct [[engine]] Reader calls (standalone mode) and HTTP calls to the [[api]] (daemon mode). The [[tui]] consumes this interface exclusively — it never touches Reader or HTTP directly.

```
DataSourceError = { type: "data-source", message: string }

DataSource = {
  get      : (Tenant, Slug) → Promise<Result<ArtifactView | null, DataSourceError>>
  search   : (Tenant, string) → Promise<Result<SearchResult[], DataSourceError>>
  traverse : (Tenant, Slug, RelType?, Depth?) → Promise<Result<ArtifactView[], DataSourceError>>
  list     : (Tenant, ListFilter?) → Promise<Result<ArtifactView[], DataSourceError>>
  listTenants : () → Promise<Result<TenantInfo[], DataSourceError>>
  reload      : (Tenant) → Promise<Result<BuildReport, DataSourceError>>
  mode        : "daemon" | "standalone"
}
```

All methods are async (Promise-returning) regardless of implementation. The tenant parameter is threaded through every query — there is no "default tenant" at this layer.

## Implementations

### ReaderDataSource

```
createReaderDataSource(tm: TenantManager) → DataSource { mode: "standalone" }
```

Wraps a [[multi-tenant]] TenantManager. Each call resolves the tenant's Reader via `tm.getReader(tenant)`, then delegates to the Reader's synchronous methods, wrapping results in Promise. Error mapping: `EngineError | TenantError → DataSourceError`.

### HttpDataSource

```
createHttpDataSource(port: string) → DataSource { mode: "daemon" }
```

Wraps HTTP fetch calls to the [[api]] server. Each call builds a URL (`/v1/{tenant}/{operation}`), makes the request, and maps the JSON response to the expected Result type. Error mapping: HTTP status → DataSourceError. Special case: `get` returns `Ok(null)` on 404 (not found is not an error).

## Laws

**DS1. Mode transparency**: for any DataSource `ds` of either implementation and identical underlying data:
```
ds.list(t) = Ok(A) ⟹ A contains the same artifacts regardless of ds.mode
```
Both implementations return identical results for the same knowledge base state. The TUI cannot distinguish which transport is in use.

**DS2. Async uniformity**: every method returns `Promise<Result<T, DataSourceError>>`, even when the underlying operation is synchronous (ReaderDataSource). This ensures the TUI never branches on sync vs async.

**DS3. Tenant-per-call**: every query method takes an explicit tenant parameter. There is no mutable "current tenant" inside the DataSource. Tenant switching is a concern of the [[tui]] App state, not the data layer.

**DS4. Error flattening**: both `EngineError`, `TenantError`, `StorageError`, and HTTP errors are mapped to the single `DataSourceError` type. The TUI does not need to understand error provenance.

## Design rationale

**Why a DataSource abstraction instead of using Reader directly?** The TUI must work identically in daemon and standalone mode (issue requirement). Without an abstraction, every view would need `if (mode === "daemon") { fetch(...) } else { reader.get(...) }`. The DataSource removes this branching.

**Why async even for synchronous Reader calls?** Consistency. React's `useEffect` is already async. Making ReaderDataSource async avoids special-casing in hooks.

**Why tenant-per-call instead of tenant-in-constructor?** The TUI supports tenant switching at runtime (key `4` or `t`). If the tenant were baked into the DataSource, switching would require constructing a new DataSource. Per-call threading is simpler and stateless.

**Why flatten all errors to one type?** The TUI displays errors as text. It does not (and should not) recover differently based on whether the error came from storage, engine, or network. One type, one rendering path.
