---
slug: validate-email
title: Validate Email
tags: [precondition, validation]
---

# Validate Email

## Precondition

Validates that an email address is well-formed and not already in use.

## Checks

1. Email matches standard format (RFC 5322)
2. Domain has valid MX records
3. Email is not already registered in the system

## Used By

This precondition is required before creating a user account. The create-user action depends on this check passing.

## Failure Modes

- `invalid_format` — email doesn't match expected pattern
- `invalid_domain` — domain has no MX records
- `already_exists` — a user with this email already exists
