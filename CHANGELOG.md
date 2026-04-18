# Changelog

## [Unreleased]

### Fixed

- Released `pramana-darwin-arm64` and `pramana-darwin-x64` binaries are now built on native macOS hardware and ad-hoc codesigned, fixing SIGKILL on macOS 15+ Apple Silicon. Existing arm64 macOS users should re-run `pramana upgrade` to pick up the properly-built binary. (#60)
