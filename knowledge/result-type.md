---
slug: result-type
title: Result Type
tags: [lib, pattern]
relationships:
  depends-on: pramana
---

# Result Type

Discriminated union for error handling: `Result<T, E> = Ok<T> | Err<E>`. Standard pattern — see Rust's `Result`, Haskell's `Either`.

## Why no exceptions

**Why Result instead of try/catch?**
Exceptions are invisible in type signatures. A function that throws looks identical to one that doesn't. With Result, the return type tells you: "this can fail, you must handle it." TypeScript has no checked exceptions, so Result is the only way to make error handling explicit.

**Why typed error objects, not strings?**
Each module defines its own error type (`FrontmatterError`, `StorageError`, `EngineError`). The `type` discriminant field tells you WHERE the error originated, not just what went wrong. This matters when a pipeline chains multiple fallible operations.

## Implementation

`src/lib/result.ts` — 11 lines total. Two constructors: `ok(value)` and `err(error)`.

## What it is NOT

This is not a monad. There's no `map`, `flatMap`, or `chain`. Callers check `result.ok` and branch. This is deliberate — monadic error handling in TypeScript adds complexity without the type inference that makes it ergonomic in Rust or Haskell. Plain `if (!result.ok)` is clearer in this context.

## Error types

| Error type | Module | Discriminant |
|-----------|--------|-------------|
| FrontmatterError | parser | `type: "frontmatter"` |
| DocumentError | parser | union of frontmatter, read, validation |
| StorageError | storage | `type: "storage"` |
| EngineError | engine | `type: "engine"` |

The Reader maps StorageError → EngineError via `mapError`, so API consumers see a uniform error type.
