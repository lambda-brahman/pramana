# Pramana

**Give Claude your domain knowledge.**

Write what you know in Markdown. Pramana makes it available to Claude — automatically. When your conversation touches your domain, Claude looks up the relevant knowledge without you having to ask.

> The reference implementation of the semantic layer described in [Knowledge Engineering: The Future of AI-Assisted Software Engineering](https://knowledgeengineering.substack.com/p/knowledge-engineering-the-future).

## Quick start

### 1. Install Pramana and the Claude plugin

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

In Claude Code:

```
/plugin marketplace add lambda-brahman/pramana
/plugin install pramana@lambda-brahman
```

### 2. Write a knowledge file

Create a Markdown file in a directory (e.g., `./knowledge/onboarding.md`):

```markdown
---
slug: onboarding-flow
title: Onboarding Flow
tags: [process, user-facing]
relationships:
  depends-on: [user-account]
  relates-to: [email-verification]
---

# Onboarding Flow

New users go through a three-step onboarding.

## Steps

1. Create account via [[depends-on::user-account]]
2. Verify email via [[email-verification]]
3. Complete profile

## Rules

- Email must be verified within 24 hours
- Profile completion is optional but recommended
```

Each file is a **knowledge artifact** — a self-contained piece of expertise with a name (`slug`), labels (`tags`), and connections to other artifacts (`relationships`).

### 3. Start Pramana and talk to Claude

In Claude Code, ask Claude to set things up:

```
/pramana:setup ./knowledge
```

Claude starts Pramana, checks that your files were loaded correctly, and reports any issues. Once running, **Claude automatically uses your knowledge base** whenever the conversation needs it.

## Using your knowledge base

There are two ways to use Pramana — nudge Claude with a hint in your prompt, or invoke the query skill directly.

### Hint in your prompt

Mention the knowledge base in parentheses and Claude will look things up:

```
"I'm working on the checkout page. How does order validation work?
(use /pramana:query to check the KB)"

"What would break if we changed the pricing model?
(check the knowledge base with /pramana:query)"
```

Claude sees the hint, invokes the query skill, searches your knowledge, reads the relevant sections, follows relationship chains, and answers grounded in what you wrote.

### Invoke directly

When you know exactly what you want to look up:

```
/pramana:query "what are the onboarding rules?"
/pramana:query "show me everything that depends on user-account"
```

For multiple knowledge bases, specify which one:

```
/pramana:query law "what is negligence?"
/pramana:query eng "how does the build pipeline work?"
```

## Writing knowledge files

A knowledge file is a Markdown file with a small header (called "frontmatter") that tells Pramana what the file is about.

### The header

Every file needs at least a `slug` — a short, lowercase name that identifies the artifact:

```yaml
---
slug: pricing-rules
title: Pricing Rules
tags: [business, billing]
relationships:
  depends-on: [subscription-plan, discount-policy]
  relates-to: [invoice]
---
```

| Field | Required | What it does |
|-------|----------|-------------|
| `slug` | Yes | Unique identifier, lowercase with hyphens (e.g., `pricing-rules`) |
| `title` | No | Human-readable name. Defaults to the first heading. |
| `tags` | No | Labels for categorizing (e.g., `[business, billing]`) |
| `relationships` | No | How this artifact connects to others |

### Relationships

There are two types:

- **depends-on** — this artifact needs the other to make sense. "Pricing rules depend on subscription plans."
- **relates-to** — these artifacts are connected but independent. "Pricing rules relate to invoices."

### The body

Write naturally using Markdown headings:

```markdown
# Pricing Rules

## Tiers

Enterprise customers get volume discounts...

## Discounts

Early-payment discount is 5% if paid within 10 days...
```

Use `##` headings to break content into sections. Claude reads specific sections rather than loading entire files, so good headings help Claude find exactly what it needs.

### Linking artifacts together

Use double-bracket links to connect ideas:

```markdown
Pricing depends on the [[depends-on::subscription-plan]].
See also [[invoice]] for billing details.
```

These links are optional — the `relationships` header is what Pramana uses to build the graph. But inline links make your files more readable.

## Let Claude write knowledge for you

```
/pramana:author "API rate limiting policy"
```

The first time you use this, Claude asks five questions about your domain, writing style, and quality standards. Then it drafts new artifacts that fit your knowledge base — with proper connections to existing artifacts.

## Multiple knowledge bases

If you have separate domains (e.g., legal knowledge and engineering knowledge), serve them together:

```
/pramana:setup ./law ./engineering
```

Claude helps you name each knowledge base and keeps them separate. When you ask a question, specify the domain:

```
/pramana:query law "what is negligence?"
/pramana:query eng "how does the build pipeline work?"
```

## How Claude uses your knowledge

When the Pramana plugin is installed and running, Claude has four ways to access your knowledge:

- **Search** — find artifacts by topic or keyword
- **Get** — read a specific artifact or section
- **Traverse** — follow dependency chains ("what does X depend on?")
- **List** — see all artifacts, optionally filtered by tags

Claude chooses the right approach automatically based on your question. It reads specific sections rather than loading everything, keeping conversations focused and efficient.

## Install options

```bash
# Latest
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh

# Specific version
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh -s v0.2.0
```

See [Releases](https://github.com/lambda-brahman/pramana/releases) for binaries.

## Try it with examples

Pramana ships with example knowledge bases (law, recipes, software architecture) you can try immediately:

```
/pramana:setup ./examples/recipes
```

See [examples/](examples/) for all available domains, or the [technical reference](docs/technical.md#example-knowledge-bases) for details.

## Further reading

- [Technical reference](docs/technical.md) — CLI commands, HTTP API, document format, multi-tenant details
- [Plugin guide](plugin/README.md) — Skill details, invocation modes, architecture

## Development

```bash
bun install
bun run test          # unit + e2e tests
bun run test:precommit  # plugin workflow tests
bun run typecheck
```

## License

Private
