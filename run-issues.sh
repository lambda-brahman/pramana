#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/sarath.soman/Dev/pramana"
WT_BASE="/Users/sarath.soman/Dev/pramana-worktrees"
mkdir -p "$WT_BASE"

run_issue() {
  local issue_num="$1"
  local branch="$2"
  local prompt="$3"
  local wt_dir="$WT_BASE/issue-$issue_num"

  echo ""
  echo "================================================================"
  echo "  Issue #$issue_num — Branch: $branch"
  echo "================================================================"
  echo ""

  # Clean up stale worktree if it exists
  if [ -d "$wt_dir" ]; then
    echo "Cleaning up stale worktree at $wt_dir..."
    cd "$REPO_DIR"
    git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
  fi

  # Delete branch if it already exists (from a previous run)
  cd "$REPO_DIR"
  git branch -D "$branch" 2>/dev/null || true

  # Create worktree with new branch
  git worktree add "$wt_dir" -b "$branch"
  cd "$wt_dir"

  echo "Running Claude in $wt_dir..."
  CLAUDECODE="" CLAUDE_CODE_ENTRYPOINT="" claude -p "$prompt" --allowedTools "Edit,Write,Read,Glob,Grep,Bash" --verbose

  # Check if there are changes to commit and PR
  if [ -n "$(git status --porcelain)" ]; then
    echo "Changes detected, creating PR..."
    git add -A
    git commit -m "$(cat <<EOF
$branch: implement issue #$issue_num

Closes #$issue_num

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
    git push origin "$branch"
    gh pr create \
      --title "$(gh issue view "$issue_num" --json title -q .title)" \
      --body "$(cat <<EOF
Closes #$issue_num

## Summary
Automated implementation of issue #$issue_num.

See the issue for full context and acceptance criteria.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
      --base main
  else
    echo "No uncommitted changes — agent may have committed directly."
    # Push if there are unpushed commits
    if [ "$(git rev-list origin/main..HEAD --count 2>/dev/null)" -gt 0 ]; then
      git push origin "$branch"
      gh pr create \
        --title "$(gh issue view "$issue_num" --json title -q .title)" \
        --body "$(cat <<EOF
Closes #$issue_num

## Summary
Automated implementation of issue #$issue_num.

See the issue for full context and acceptance criteria.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
        --base main
    fi
  fi

  # Return to repo dir
  cd "$REPO_DIR"
  echo ""
  echo "✓ Issue #$issue_num complete."
  echo ""
}

# ─────────────────────────────────────────────────────────────
# Issue #3 — SKIPPED (manual)
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# Issue #4 — pramana lint
# ─────────────────────────────────────────────────────────────
run_issue 4 "feat/issue-4-pramana-lint" "$(cat <<'PROMPT'
You are working on the Pramana project. Your task is to implement GitHub issue #4:
"feat(cli): add pramana lint for knowledge base validation"

This is a Bun + TypeScript project. Read CLAUDE.md for conventions. Key rules:
- Runtime is Bun (not Node.js)
- Result<T,E> pattern — no throw, no new Error
- Zod for validation
- kebab-case file names
- biome for linting (run bun run lint)
- Tests in test/ mirroring src/

Read the existing code to understand the architecture:
- src/parser/frontmatter.ts — frontmatter parsing
- src/parser/document.ts — document validation
- src/parser/wikilinks.ts — wikilink parsing
- src/engine/builder.ts — batch ingestion, BuildReport
- src/schema/index.ts — Zod schemas
- src/cli/index.ts — CLI entry point
- src/lib/result.ts — Result type

Implement `pramana lint --source <dir>` with two phases:

**Phase 1 — File-level checks:**
- Frontmatter present and well-formed
- slug present and valid
- Tags are all strings (warn if non-string filtered)
- Relationship types are valid (warn instead of silently coercing)
- Frontmatter relationships parse correctly (warn instead of silently dropping)

**Phase 2 — Graph-level checks (after building):**
- Dangling links: relationships/wikilinks pointing to slugs that don't exist
- Duplicate slugs: two+ files with same slug
- Orphan artifacts: no inbound or outbound relationships (info level)

Output format:
- error/warn/info severity levels with file paths
- Summary line: "X files, Y errors, Z warnings, W info"
- Exit code 1 on errors, 0 otherwise
- --strict flag to treat warnings as errors

Also support `pramana lint --tenant <name>` against a running daemon (reuse the daemon's data).

Write tests in test/unit/ for the lint logic. Run `bun test` to verify. Run `bun run lint` to ensure biome passes.

Use conventional commits:
  feat(cli): add pramana lint command with file and graph validation

Do NOT create a PR. Just commit to the current branch.
PROMPT
)"

# ─────────────────────────────────────────────────────────────
# Issue #2 — README improvements
# ─────────────────────────────────────────────────────────────
run_issue 2 "docs/issue-2-readme-improvements" "$(cat <<'PROMPT'
You are working on the Pramana project. Your task is to implement GitHub issue #2:
"docs: improve README first-time user experience"

Read the current README.md. Then improve it with these changes:

1. **Add a "Why" section** after the tagline — a short before/after showing Claude without vs with Pramana knowledge. Keep it to 3-5 lines.
2. **Add prerequisites & platform support** — macOS (arm64, x64), Linux (x64), Windows (x64). Clarify that the install script downloads a standalone binary (no Bun/Node needed).
3. **Add a note** near plugin install commands that this requires Claude Code with plugin marketplace support.
4. **Surface configuration** — briefly mention port config (--port, PRAMANA_PORT env var, default 5111) in the main README.
5. **Add motivation to author agents section** — one line explaining when/why (team standards, CI artifact generation).
6. **Add a Troubleshooting section** with 3-5 common issues (daemon won't start, files not loading, Claude not using KB).
7. **Add Uninstall instructions** (remove binary + plugin).
8. **Update stale version reference** — change v0.2.0 example to current version or say "see Releases."
9. **Document `pramana lint`** — add a brief mention that users can validate their knowledge base with pramana lint.

Keep the README's existing tone and structure. Don't over-explain. This is a developer tool — be concise.

Use conventional commits:
  docs: improve README with prerequisites, troubleshooting, and lint reference

Do NOT create a PR. Just commit to the current branch.
PROMPT
)"

# ─────────────────────────────────────────────────────────────
# Cleanup worktrees
# ─────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  Cleaning up worktrees"
echo "================================================================"
cd "$REPO_DIR"
for issue in 4 2; do
  wt_dir="$WT_BASE/issue-$issue"
  if [ -d "$wt_dir" ]; then
    git worktree remove "$wt_dir" --force 2>/dev/null || true
  fi
done
rmdir "$WT_BASE" 2>/dev/null || true

echo ""
echo "================================================================"
echo "  All done! PRs created:"
echo "================================================================"
gh pr list --state open --json number,title,url --template '{{range .}}#{{.number}} {{.title}}
  {{.url}}
{{end}}'
