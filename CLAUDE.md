# Pramana — Knowledge Engine

## Runtime
- Bun (not Node.js)
- `bun test` for tests
- `bun:sqlite` for SQLite
- `Bun.serve()` for HTTP
- `Bun.file` over `node:fs`

## Architecture
- Source files parsed at startup → in-memory SQLite
- Four read-only primitives: get, search, traverse, list
- Result<T,E> for error handling — no thrown exceptions
- Manual dependency wiring, no DI framework

## Code Style
- Zod for validation
- kebab-case file names
- No classes where plain functions suffice
- Tests co-located in test/ directory mirroring src/
