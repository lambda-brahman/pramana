---
slug: result-type
title: Result Type
tags: [lib, pattern]
relationships:
  depends-on: pramana
---

# Result Type

## Specification

```
type Ok<T>  = { ok: true,  value: T }
type Err<E> = { ok: false, error: E }
type Result<T, E> = Ok<T> | Err<E>

ok  : T → Ok<T>
err : E → Err<E>
```

Two constructors, one discriminated union. No methods, no monadic operations.

## Laws

**Discrimination**: `result.ok = true ⟹ result.value exists`, `result.ok = false ⟹ result.error exists`

**Exhaustion**: every Result is exactly one of Ok or Err, never both, never neither.

## Error type convention

Each module defines a branded error type with a discriminant field:

```
type FrontmatterError = { type: "frontmatter", message: string }
type StorageError     = { type: "storage",     message: string }
type EngineError      = { type: "engine",      message: string }
type DocumentError    = FrontmatterError | ReadError | ValidationError
```

The `type` field identifies origin. The `message` field is human-readable.

Error mapping across layers: `mapError : Result<T, StorageError> → Result<T, EngineError>` — preserves the message, changes the discriminant.

## Why not exceptions

TypeScript has no checked exceptions. A function's throw behavior is invisible in its type signature. Result makes fallibility explicit — the caller MUST handle both branches. The trade-off: verbose `if (!result.ok)` checks. Accepted because explicit error handling matters more than brevity in a pipeline that chains multiple fallible operations.

## Why not monadic

No `map`, `flatMap`, `chain`. TypeScript's type inference doesn't make monadic composition ergonomic the way Rust or Haskell does. Plain branching is clearer here.
