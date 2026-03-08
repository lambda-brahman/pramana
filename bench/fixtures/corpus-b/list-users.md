---
slug: list-users
title: List Users
tags: [action, user-management]
relationships:
  depends-on: [check-rate-limit]
---

# List Users

## Action

Lists all users with optional filtering.

## Endpoint

GET /api/users

## Parameters

| Name   | Type   | Required | Description                          |
|--------|--------|----------|--------------------------------------|
| role   | string | no       | Filter by role: admin, member, viewer |
| limit  | number | no       | Max results (default 50, max 200)     |
| offset | number | no       | Pagination offset                     |

## Response

200 OK — returns `{ users: User[], total: number }`.

## Constraints

- Requires `users:read` permission
