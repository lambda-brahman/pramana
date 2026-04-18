---
slug: check-rate-limit
title: Check Rate Limit
tags: [precondition, constraint]
---

# Check Rate Limit

## Precondition

Enforces per-API-key rate limits to prevent abuse.

## Limits

| Operation | Limit              |
|-----------|--------------------|
| Read      | 100 requests/min   |
| Write     | 10 requests/min    |
| Delete    | 5 requests/min     |

## Checks

1. Look up current request count for the API key in the sliding window
2. Compare against the limit for the operation type
3. If exceeded, reject with retry-after header

## Failure Modes

- `rate_limited` — too many requests, includes `retry_after_seconds`
