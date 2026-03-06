---
slug: rate-limiter
title: Rate Limiter
tags: [service, infrastructure]
relationships:
  relates-to: [api-gateway]
---

# Rate Limiter

The rate limiter protects backend services from overload by enforcing request quotas. It is used by the [[relates-to::api-gateway]] to throttle incoming requests before they reach backend services.

## Algorithm

The rate limiter uses a **sliding window** algorithm:

1. Each client is identified by API key or IP address
2. Requests are counted in a sliding time window (e.g., 60 seconds)
3. When the count exceeds the limit, subsequent requests receive `429 Too Many Requests`
4. The response includes a `Retry-After` header indicating when the client can retry

### Why sliding window?

| Algorithm | Pros | Cons |
|-----------|------|------|
| Fixed window | Simple, low memory | Allows burst at window boundary |
| Sliding window | Smooth rate enforcement | Slightly more memory |
| Token bucket | Allows controlled bursts | More complex to tune |
| Leaky bucket | Very smooth output | No burst tolerance |

The sliding window balances simplicity with accuracy. It avoids the boundary burst problem of fixed windows without the complexity of token or leaky bucket algorithms.

## Configuration

Rate limits are configured per tier:

```yaml
tiers:
  free:
    requests_per_minute: 60
    requests_per_hour: 1000
    burst: 10

  pro:
    requests_per_minute: 300
    requests_per_hour: 10000
    burst: 50

  enterprise:
    requests_per_minute: 1000
    requests_per_hour: 50000
    burst: 200
```

## Limits

### Response headers

Every response includes rate limit information:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds until the client can retry (only on 429) |

### Exemptions

Some paths are exempt from rate limiting:

- `/health` — health check endpoint
- `/auth/validate` — internal token validation (service-to-service)
- Paths marked with `skip_rate_limit: true` in the gateway routing config

### Storage

Rate limit counters are stored in Redis for fast access and automatic expiry. If Redis is unavailable, the rate limiter falls back to in-memory counters (per-instance, not shared across gateway replicas).
