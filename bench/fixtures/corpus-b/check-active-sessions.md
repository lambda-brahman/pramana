---
slug: check-active-sessions
title: Check Active Sessions
tags: [precondition, safety]
---

# Check Active Sessions

## Precondition

Verifies whether a user has active sessions before allowing destructive operations.

## Checks

1. Query session store for user ID
2. Return count of active (non-expired) sessions

## Used By

Required before deleting a user. If active sessions exist, the delete must either be blocked or the `force` flag must be set.

## Failure Modes

- `has_active_sessions` — user has N active sessions that would be terminated
