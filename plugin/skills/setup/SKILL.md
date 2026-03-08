---
name: setup
description: Start a Pramana daemon, monitor ingestion, and diagnose errors
args: source_dirs
user_invocable: true
disable-model-invocation: true
---

# Pramana Setup

You are setting up a Pramana knowledge engine daemon. Guide the user through starting the daemon, monitoring ingestion, and fixing any errors.

## Arguments

The user provides one or more knowledge directories: **$ARGUMENTS**

## Step 0: Check CLI availability and version

Before anything else, verify the `pramana` CLI is installed and up to date:

```bash
command -v pramana
```

**If not found**, install it automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

Then verify it installed correctly:

```bash
pramana version
```

**If found**, check for updates and upgrade:

```bash
pramana version --check
```

If an upgrade is available:

```bash
pramana upgrade
```

If the install or upgrade fails, report the error to the user and **stop** — do not proceed to Step 1.

## Step 1: Start the daemon

Every knowledge base is a named tenant. Help the user name each tenant. Names must be lowercase, start with a letter, and contain only `a-z`, `0-9`, `-`. Reserved names that cannot be used: `get`, `search`, `traverse`, `list`, `tenants`, `reload`.

```bash
pramana serve --source <dir>:<name> [--source <dir2>:<name2>] --port 5111
```

Run the command in the background and capture stderr for the ingestion report.

## Step 2: Parse ingestion report

The daemon prints ingestion summaries to stderr:

```
[tenant-name] Ingested 42/45 files (3 failed)
  ✗ /path/to/file.md: error message
```

Check for:
- **All succeeded**: Report success, move to verification
- **Some failed**: Examine each failed file to diagnose

## Step 3: Diagnose failures

For each failed file:

1. Read the file content
2. Common issues:
   - **Missing frontmatter**: File needs `---` delimiters with at least a `slug` field
   - **Missing slug**: Frontmatter exists but no `slug` key
   - **Invalid YAML**: Check for tabs (use spaces), unclosed quotes, malformed arrays
   - **Invalid relationship type**: Only `depends-on` and `relates-to` are valid
   - **Duplicate slug**: Two files declare the same slug
3. Show the user the problem and suggest a fix
4. After fixes, reload: `pramana reload --tenant <name>`

## Step 4: Verify

Run verification commands:

```bash
pramana list --tenant <name>
```

Report:
- Number of artifacts ingested per tenant
- Any remaining issues
- Confirm the daemon is serving

## Multi-tenant guidance

When helping users set up multiple tenants:
- Suggest meaningful tenant names that reflect the knowledge domain
- Each source directory is independently ingested with its own SQLite database
- Tenants are fully isolated — no cross-tenant queries
- `--tenant` is required for all query commands — there is no default tenant
- Use `pramana reload --tenant <name>` to re-ingest a single tenant without restarting

## Success message

Once everything is running:
```
Pramana daemon is running on port 5111.
- Tenants: <list of tenant names with artifact counts>
- Query with: pramana get <slug> --tenant <name>
- Use /pramana:query to search the knowledge base
- Use /pramana:create-author to set up your author agent
- Use /pramana:author to create new artifacts
```
