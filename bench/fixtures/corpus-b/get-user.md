---
slug: get-user
title: Get User
tags: [action, user-management]
relationships:
  depends-on: [check-rate-limit]
---

# Get User

## Action

Retrieves a user by ID or email.

## Endpoint

GET /api/users/:id
GET /api/users?email=:email

## Parameters

| Name  | Type   | Required | Description                    |
|-------|--------|----------|--------------------------------|
| id    | string | no       | User ID (path parameter)       |
| email | string | no       | Email address (query parameter) |

One of `id` or `email` must be provided.

## Response

200 OK — returns the user object.
404 Not Found — if no user matches.

## Constraints

- Requires `users:read` permission
