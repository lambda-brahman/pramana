---
slug: check-last-admin
title: Check Last Admin
tags: [precondition, safety]
---

# Check Last Admin

## Precondition

Prevents the system from having zero admin users. Must be checked before any operation that could remove an admin.

## Checks

1. Count users with role=admin
2. If count would drop to zero after the operation, block it

## Used By

Required before deleting an admin user or demoting an admin to a lower role.

## Failure Modes

- `last_admin` — this is the only admin; operation would leave the system without an administrator
