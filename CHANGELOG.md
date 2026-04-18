# Changelog

## [Unreleased]

### Changed

- **Behavior change:** `--standalone` is now TUI-only. Read subcommands (`get`, `search`, `traverse`, `list`) route exclusively through the daemon. If the daemon is not running, they exit 1 with `"Pramana daemon not running. Start it with: pramana serve"`. The in-process rebuild fallback has been removed. (#65)

### Fixed

- Released `pramana-darwin-arm64` and `pramana-darwin-x64` binaries are now built on native macOS hardware so Bun emits a signable Mach-O with `LC_CODE_SIGNATURE`, fixing SIGKILL on macOS 15+ Apple Silicon. Existing arm64 macOS users should re-run `pramana upgrade` to pick up the properly-built binary. (#60)
