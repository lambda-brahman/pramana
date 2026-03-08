---
slug: delete-user
title: Delete User
tags: [action, user-management]
relationships:
  depends-on: [check-active-sessions, check-rate-limit]
  relates-to: [get-user]
---

# Delete User

## Action

Permanently deletes a user account. This is irreversible.

## Endpoint

DELETE /api/users/:id

## Parameters

| Name   | Type   | Required | Description         |
|--------|--------|----------|---------------------|
| id     | string | yes      | The user's unique ID |
| force  | boolean | no      | Skip active session check. Defaults to false |

## Preconditions

1. User must exist (call get-user first to verify)
2. User must have no active sessions (unless force=true)
3. Cannot delete the last admin user

## Response

204 No Content on success.

## Constraints

- Irreversible — deleted users cannot be recovered
- Requires `users:delete` permission
- Rate limited to 5 deletions per minute
