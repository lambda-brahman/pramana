---
slug: api-gateway
title: API Gateway
tags: [service, infrastructure]
relationships:
  depends-on: [auth-service, rate-limiter]
---

# API Gateway

The API gateway is the single entry point for all client requests. It handles routing, authentication, and rate limiting before forwarding requests to backend services.

## Responsibilities

- **Request routing** — maps incoming URLs to the correct backend service
- **Authentication** — validates tokens via the [[depends-on::auth-service]] before allowing requests through
- **Rate limiting** — enforces request quotas via the [[depends-on::rate-limiter]] to protect backend services
- **Response aggregation** — can combine responses from multiple services into a single response
- **TLS termination** — handles HTTPS at the edge so backend services communicate over plain HTTP internally

## Routing

Routes are configured declaratively:

```yaml
routes:
  - path: /api/users/*
    service: user-service
    methods: [GET, POST, PUT, DELETE]

  - path: /api/auth/*
    service: auth-service
    methods: [POST]
    skip_auth: true

  - path: /api/admin/*
    service: admin-service
    methods: [GET, POST]
    roles: [admin]
```

The gateway matches the longest prefix first. Wildcards (`*`) match any suffix.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `listen_port` | 8080 | Port the gateway listens on |
| `read_timeout` | 30s | Max time to read a client request |
| `write_timeout` | 30s | Max time to write a response |
| `max_body_size` | 10MB | Maximum request body size |
| `cors_origins` | `[]` | Allowed CORS origins |
| `health_check_path` | `/health` | Health check endpoint |

The gateway itself is stateless. All configuration is loaded at startup and can be reloaded with a SIGHUP signal.
