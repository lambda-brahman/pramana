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

## Cargo features (`pramana-cli`)

The `pramana` binary uses compile-time feature flags instead of a runtime plugin system. Each optional subsystem is gated behind a Cargo feature so that builds can trade binary size for functionality.

| Feature | Default | Crate gated | Description |
|---------|---------|-------------|-------------|
| `mcp` | yes | `pramana-mcp`, `tokio` | MCP stdio server (`pramana mcp`) |
| `tui` | yes | `pramana-tui` | Interactive terminal UI (`pramana tui`) |
| `embeddings` | no | `pramana-embedder` (via `pramana-engine/embeddings`) | ML-based semantic search (ONNX Runtime + tokenizers) |

### Build examples

```bash
cargo build -p pramana-cli                        # default: mcp + tui
cargo build -p pramana-cli --no-default-features  # core CLI only (serve, get, search, ...)
cargo build -p pramana-cli --all-features         # everything including embeddings
cargo build -p pramana-cli --no-default-features --features mcp  # core + MCP, no TUI
```

### Deprecated / removed

The TypeScript tree had a runtime `StoragePlugin` interface allowing pluggable storage backends. The Rust port uses a concrete `Storage` type (SQLite) with no runtime extensibility — only one backend exists and the indirection added complexity without value. If a second backend is needed in the future, a trait can be introduced at that point.

The TypeScript `upgradePlugin()` function (downloading Claude plugin archives from GitHub releases) is not yet ported. The Rust `pramana upgrade` command upgrades the CLI binary only.

## Crate layout

```
crates/
  pramana-core/      # library: reserved for shared types
  pramana-cli/       # binary: CLI surface, daemon, feature-gated MCP + TUI
  pramana-parser/    # library: markdown/YAML parsing
  pramana-storage/   # library: SQLite storage + FTS5
  pramana-engine/    # library: query engine, tenant manager, optional embeddings
  pramana-embedder/  # library: ONNX Runtime embeddings (optional)
  pramana-mcp/       # library: MCP stdio server (optional)
  pramana-tui/       # library: ratatui terminal UI (optional)
```

## TUI keybinding parity matrix

The ratatui TUI (pramana-tui) ports keybindings from the Ink/React TUI. This matrix tracks parity across the three MVP views.

### kb-list

| Key | Ink (TS) | ratatui (Rust) | Notes |
|-----|----------|----------------|-------|
| j/k | Navigate | Navigate | |
| ↑/↓ | Navigate | Navigate | |
| Enter | Open KB | Open KB | |
| a | Add KB | Add KB | Name → dir two-step form |
| d | Delete KB | Delete KB | y/n confirmation |
| o | Open source dir | Open source dir | macOS/Linux/Windows |
| r | Reload KB | Reload KB | |
| S | Toggle daemon | Toggle daemon | Standalone-only message |
| q | Quit | Quit | |
| Esc | Quit | Quit | |
| ? | Help overlay | Help overlay | |

### artifact-detail

| Key | Ink (TS) | ratatui (Rust) | Notes |
|-----|----------|----------------|-------|
| j/k | Scroll (content) / Navigate (rel/sec) | Scroll / Navigate | |
| ↑/↓ | Scroll / Navigate | Scroll / Navigate | |
| d/u | Half-page scroll | Half-page scroll | Content panel only |
| h/l | Pan left/right | Pan left/right | Content panel, 10-char step |
| ←/→ | Pan left/right | — | Not bound (h/l suffice) |
| 0 | Reset horizontal scroll | Reset horizontal scroll | |
| Tab | Cycle panels | Cycle panels | content → relationships → sections |
| Enter | Follow link / jump to section | Follow link / jump to section | |
| Esc | Back | Back | |
| q | — | Back | Added for consistency |
| ? | Help overlay | Help overlay | |

### search

| Key | Ink (TS) | ratatui (Rust) | Notes |
|-----|----------|----------------|-------|
| (type) | Search query | Search query | 200ms debounce |
| Enter/↓ | Focus results | Focus results | From input mode |
| j/k | Navigate results | Navigate results | Results mode |
| ↑/↓ | Navigate results | Navigate results | |
| h/l | Pan snippet | Pan snippet | Results mode, 10-char step |
| Enter | View artifact | View artifact | Results mode |
| Esc | Clear / back | Clear / back | Input: clear then back; Results: back to input |
| ? | Help overlay | Help overlay | Results mode only |

### graph

| Key | ratatui (Rust) | Notes |
|-----|----------------|-------|
| j/k | Navigate | |
| ↑/↓ | Navigate | |
| Enter | View artifact | Opens artifact-detail for selected node |
| g | Re-root graph | Traverses from selected node |
| +/- | Change depth | Depth 1–5, re-fetches traversal |
| Esc | Back | |
| q | Back | |
| ? | Help overlay | |

### Dropped from MVP (follow-up issues needed)

| View | Status |
|------|--------|
| kb-context (hub menu) | Skipped — kb-list goes directly to search |
| artifact-list (browse) | Skipped — use search instead |
| graph (traversal) | Implemented (#157) |
| dashboard (info/stats) | Skipped |

### Diff tolerance

Golden snapshots use ratatui's `Buffer` (cell-level text without ANSI escapes). Snapshot comparisons are text-exact. Color rendering depends on terminal capabilities (256-color assumed). ANSI escape sequences are not compared — only logical content.

## Release workflow

### Cutting a pre-release

Pre-release tags are used to canary-test Rust binaries before the capstone swap to `main`.

```bash
# From rust-port branch:
scripts/release.sh 0.14.0-rc.1
```

This bumps all version files (TypeScript + Cargo workspace), creates the `v0.14.0-rc.1` tag, and pushes. The `release-rust.yml` workflow builds binaries and publishes a GitHub pre-release.

### Installing a pre-release

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/rust-port/install.sh | sh -s -- v0.14.0-rc.1
```

The installer fetches the specific tag, verifies the SHA256 checksum, and places the binary in `~/.local/bin/pramana`.

### Rollback to TypeScript

If a Rust release must be yanked (crash, data loss, missing feature):

1. **Delete the Rust release** on GitHub (or mark it as draft).
2. **Reinstall the last TypeScript release:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh -s -- v0.13.1
   ```
   Replace `v0.13.1` with the last known-good TypeScript tag. The `main` branch `install.sh` always works for TypeScript releases.
3. **Verify:**
   ```bash
   pramana --version
   ```

The `/latest/download/` endpoint on GitHub skips pre-releases, so users who installed without a version argument (`install.sh` with no args) will continue to get the latest stable TypeScript release until a stable Rust release is published.

After the capstone swap (`rust-port` → `main`), the rollback path is the same: pin a specific TypeScript tag in the install command.

## License aggregation plan

All new Rust dependencies must be permissively licensed (MIT, Apache-2.0, or dual). Before the capstone PR, run `cargo-deny check licenses` and commit the `deny.toml` config. Any dependency with a non-permissive license requires explicit sign-off in the PR description.
