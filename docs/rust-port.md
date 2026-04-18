# Rust Port

## Branch strategy

`rust-port` is the integration branch for the Rust rewrite. It stays isolated from `main` so the TypeScript tree ships continuously while port work accumulates.

```
main  ──────────────────────────────────► (TypeScript, always releasable)
          │
          └── rust-port ──► port/X ──┐
                         ──► port/Y ──┤
                         ──► port/Z ──┘
                              │
                              └── capstone PR ──► main  (MVP parity reached)
```

### Flow for sub-issues

1. Branch from `rust-port`: `git checkout -b port/<feature> rust-port`
2. Implement the feature (see open `port(X)` issues under #105)
3. Open a PR targeting **`rust-port`** (not `main`)
4. CI (`ci-rust.yml`) must be green: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
5. Merge into `rust-port`

### Capstone PR

When the Rust crate reaches MVP parity (see below), open a single PR from `rust-port` into `main`. That PR replaces the TypeScript entry points with Rust binaries. After merge, `rust-port` is retired.

## MVP definition

The Rust port reaches MVP when all of the following are true:

- `pramana-core` can parse markdown source files (front-matter + body) into the same data model as the TypeScript engine
- `pramana-core` exposes the four read-only primitives: `get`, `search`, `traverse`, `list`
- `pramana-cli` compiles to a static binary that answers the same CLI surface as the TypeScript binary (verified by the existing smoke-test suite run against the Rust binary)
- All existing unit and e2e tests pass when the `PRAMANA_BIN` env var points to the Rust binary

Features explicitly **not** required for MVP: MCP transport, TUI, plugin host, multi-tenant routing, embedding.

## Crate layout

```
crates/
  pramana-core/   # library: parser, storage, query primitives
  pramana-cli/    # binary: CLI surface, daemon, MCP transport
```

## License aggregation plan

All new Rust dependencies must be permissively licensed (MIT, Apache-2.0, or dual). Before the capstone PR, run `cargo-deny check licenses` and commit the `deny.toml` config. Any dependency with a non-permissive license requires explicit sign-off in the PR description.
