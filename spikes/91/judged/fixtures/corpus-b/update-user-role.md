---
slug: update-user-role
title: Update User Role
tags: [action, user-management]
relationships:
  depends-on: [get-user, check-last-admin, check-rate-limit]
---

# Update User Role

## Action

Changes a user's role. Restricted operation with safety checks.

## Endpoint

PATCH /api/users/:id/role

## Parameters

| Name | Type   | Required | Description                          |
|------|--------|----------|--------------------------------------|
| id   | string | yes      | The user's unique ID                  |
| role | string | yes      | New role: admin, member, or viewer    |

## Preconditions

1. User must exist (verify via get-user)
2. Cannot demote the last admin (check-last-admin must pass)
3. Only admins can promote to admin role

## Response

200 OK — returns the updated user object.

## Constraints

- Requires `users:write` permission
- Audit logged — all role changes are recorded
