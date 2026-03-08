---
slug: permissions
title: Permission Model
tags: [constraint, security]
relationships:
  relates-to: [create-user, delete-user, get-user, list-users, update-user-role]
---

# Permission Model

## Overview

All API actions require specific permissions. Permissions are granted per API key.

## Available Permissions

| Permission     | Grants access to              |
|----------------|-------------------------------|
| users:read     | get-user, list-users          |
| users:write    | create-user, update-user-role |
| users:delete   | delete-user                   |

## Rules

- Permissions are checked before any action executes
- An API key can hold multiple permissions
- The `users:delete` permission is separate from `users:write` as a safety measure
- Promoting a user to admin requires the caller to also be an admin (in addition to `users:write`)
