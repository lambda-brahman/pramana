# Pramana — Knowledge Engine

## Runtime
- **Rust** workspace (stable toolchain). `rustc --version` must match CI (`dtolnay/rust-toolchain@stable`).
- `cargo test --workspace` for tests
- `rusqlite` (bundled) + `sqlite-vec` for SQLite + vector search
- `tiny_http` for the daemon HTTP server
- `rmcp` for the MCP stdio server
- `ratatui` + `crossterm` for the TUI

## Architecture
- Crates under `crates/pramana-*/` form a workspace with compile-time `mcp` / `tui` feature gates.
- Source files parsed at startup → in-memory SQLite
- Four read-only primitives: `get`, `search`, `traverse`, `list`
- `Result<T, E>` for fallible boundaries — no `panic!` in hot paths
- No `unwrap()`/`expect()` on runtime values from untrusted sources
- Manual wiring, no DI framework

## Code Style
- Prefer `serde::Serialize` full-path in `#[derive(...)]` rather than `use serde::Serialize;`
  (avoids rebase/merge conflicts on integration branches)
- Snake_case module files (Rust convention) — `crates/<crate>/src/<module>.rs`
- Tests alongside the crate: `crates/<crate>/tests/*.rs` for integration, `#[cfg(test)]` for unit
- Shared test fixtures live in `test/fixtures/` and `test/fixtures-alt/` (workspace-level)
- `#[serde(rename_all = "camelCase")]` is a contract change — grep downstream test keys before adding

## Commits
- Use conventional commits: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`
- Scopes: `engine`, `cli`, `plugin`, `author`, `build` — or omit
- Examples:
  - `feat(engine): add fts5 stemmer config per tenant`
  - `fix(cli): propagate non-zero exit on doctor error`
  - `docs: update README with troubleshooting`
  - `chore(build): bump biome to 2.5`

## Branches
- `main` is always releasable
- Feature branches: `feat/<short-description>` / `fix/<short-description>` / `chore/<short-description>`
- Delete branches after merge

## Pull Requests
- One logical change per PR
- Title follows conventional commit format
- Link related issues (e.g. `Closes #7`)
- Review PR description for LLM artifacts before submitting

## Labels
Every issue and PR should have at least one label.
- `bug` · `enhancement` · `documentation` · `dx` · `chore`
- `onboarding` · `tui` · `good first issue` · `help wanted`
- `question` · `duplicate` · `invalid` · `wontfix`

## Releases
- Run `scripts/release.sh <version>` from `main` — bumps `crates/*/Cargo.toml` + `Cargo.lock`, commits, tags `v<version>`, pushes.
- `release-rust.yml` triggers on `v*` tags, builds the 5-target binary matrix (darwin arm64/x64, linux arm64/x64, windows x64), aggregates licenses via `cargo-about`, and publishes the GitHub release.
- Pre-release tags use semver suffix: `0.15.0-rc.1` → release marked `prerelease: true`.

## Testing
- `cargo test --workspace` — full test suite
- `cargo test --workspace --lib` — fast unit subset (pre-commit hook runs this)
- `cargo fmt --check` + `cargo clippy --workspace -- -D warnings` — format + lint
- Pre-commit hook (`.githooks/pre-commit`): runs the Rust triple (fmt + clippy + lib tests)
- Commit-msg hook (`.githooks/commit-msg`): validates conventional commit format
- Install hooks: `git config core.hooksPath .githooks`
