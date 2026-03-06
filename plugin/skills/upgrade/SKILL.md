---
name: upgrade
description: Upgrade the Pramana CLI and check for plugin updates
user_invocable: true
disable-model-invocation: true
---

# Pramana Upgrade

You are upgrading the Pramana CLI and checking for plugin updates.

## Step 1: Upgrade CLI

First, check if `pramana` is installed:

```bash
command -v pramana
```

**If not found**, install it:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

**If found**, get the current version and upgrade:

```bash
pramana version
```

```bash
pramana upgrade
```

Report what happened: upgraded from X to Y, or already up to date.

## Step 2: Check plugin version

Fetch the latest plugin version from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/.claude-plugin/marketplace.json
```

Parse the `version` field from the first plugin entry in the JSON.

Then check the locally installed plugin version by reading the plugin's `plugin.json`. Look for it in the installed plugins directory — typically `~/.claude/plugins/pramana@lambda-brahman/.claude-plugin/plugin.json` or similar. If you cannot find it, check if the plugin directory exists under the Claude plugins path.

Compare the remote version against the local version.

If the plugin is outdated, tell the user:

```
A newer plugin version (vX.Y.Z) is available. To update the skills, run:
  /plugin install pramana@lambda-brahman
```

If up to date, confirm.

## Step 3: Summary

Report what was done:
- **CLI**: upgraded from X to Y / already up to date
- **Plugin**: up to date / update available (with instructions above)
