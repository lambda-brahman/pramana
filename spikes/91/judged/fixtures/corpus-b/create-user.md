---
slug: create-user
title: Create User
tags: [action, user-management]
relationships:
  depends-on: [validate-email, check-rate-limit]
---

# Create User

## Action

Creates a new user account in the system.

## Endpoint

POST /api/users

## Parameters

| Name     | Type   | Required | Description              |
|----------|--------|----------|--------------------------|
| email    | string | yes      | User's email address     |
| name     | string | yes      | Full name                |
| role     | string | no       | One of: admin, member, viewer. Defaults to member |

## Response

201 Created — returns the user object with generated `id`.

## Constraints

- Email must be unique across the system
- Rate limited to 10 creations per minute per API key
- Requires `users:write` permission
