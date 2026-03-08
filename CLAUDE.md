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
- No `throw` — always return Result<T, E>. No `new Error` either.
- `biome check` must pass — run `bun run lint` before committing
- Manual dependency wiring, no DI framework

## Code Style
- Zod for validation
- kebab-case file names
- No classes where plain functions suffice
- Tests co-located in test/ directory mirroring src/

## Commits
- Use conventional commits: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`
- Scopes: `engine`, `cli`, `plugin`, `author`, `build`
- Omit the scope only when the change is cross-cutting or docs-only
- Examples:
  - `feat(plugin): add multi-tenant query routing`
  - `fix(engine): handle empty frontmatter gracefully`
  - `docs: update README with troubleshooting section`
  - `chore(build): bump biome to 2.5`
  - `test(cli): add reload lifecycle tests`

## Branches
- `main` is always releasable
- Feature branches: `feat/<short-description>`
- Fix branches: `fix/<short-description>`
- Delete branches after merge

## Pull Requests
- One logical change per PR
- Title follows conventional commit format
- Link related issues (e.g. `Closes #7`)
- Review PR description for LLM artifacts before submitting

## Releases
- Update versions in `package.json` and `src/version.ts`
- Create and push a tag named `v<version>` (for example `v0.9.0`)
- Tagged CI builds the binaries and publishes the GitHub release artifacts

## Testing
- `bun test test/unit/ test/e2e/` — full test suite
- `bun test test/precommit/` — fast pre-commit subset
- `bun run lint` — biome check
- `bun run typecheck` — TypeScript type checking
- Pre-commit hook (`.githooks/pre-commit`): runs `bun run lint && bun test test/precommit/`
- Commit-msg hook (`.githooks/commit-msg`): validates conventional commit format
- Hook installed via `bun run prepare` (sets `core.hooksPath`)
