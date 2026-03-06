---
slug: result-type
title: Result Type
tags: [lib, pattern]
relationships:
  of: pramana
---

# Result Type

A discriminated union for error handling without exceptions. Every fallible operation in [[pramana]] returns a `Result<T, E>` instead of throwing.

## Definition

```
type Ok<T>  = { ok: true;  value: T }
type Err<E> = { ok: false; error: E }
type Result<T, E> = Ok<T> | Err<E>
```

## Constructors

- `ok(value)` — wraps a success value
- `err(error)` — wraps an error value

## Error types

Each module defines its own error type:

- `FrontmatterError` — `{ type: "frontmatter", message }`
- `DocumentError` — union of frontmatter, read, and validation errors
- `StorageError` — `{ type: "storage", message }`
- `EngineError` — `{ type: "engine", message }`

The [[reader]] maps storage errors to engine errors via `mapError`.
