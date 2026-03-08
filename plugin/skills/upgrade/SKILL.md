---
name: upgrade
description: Upgrade the Pramana CLI and plugin
user_invocable: true
disable-model-invocation: true
---

# Pramana Upgrade

You are upgrading the Pramana CLI and plugin.

## Step 1: Check CLI availability

First, check if `pramana` is installed:

```bash
command -v pramana
```

**If not found**, install it:

```bash
curl -fsSL https://raw.githubusercontent.com/lambda-brahman/pramana/main/install.sh | sh
```

## Step 2: Upgrade

**If found**, get the current version and run the upgrade:

```bash
pramana version
```

```bash
pramana upgrade
```

The `pramana upgrade` command handles everything:
- Downloads and installs the latest CLI binary
- Downloads and installs the latest plugin from the GitHub release (`plugin.tar.gz`)
- Updates `~/.claude/plugins/installed_plugins.json`

## Step 3: Summary

Report what happened based on the upgrade output:
- **CLI + Plugin upgraded**: "Upgraded CLI X → Y with plugin"
- **CLI upgraded, plugin failed**: "Upgraded CLI X → Y (plugin upgrade failed — you can retry with `pramana upgrade`)"
- **Already up to date**: "pramana X is already up to date"
