---
slug: api
title: HTTP API
tags: [api, module]
relationships:
  depends-on: [pramana, engine, multi-tenant]
---

# HTTP API

## Specification

Read-only JSON API. Each endpoint maps to a Reader operation. Supports both single-tenant and [[multi-tenant]] modes.

```
Server(port: nat, tenantManager: TenantManager) → HTTPServer
Server(port: nat, reader: Reader) → HTTPServer        // backward compat
```

### Single-tenant endpoints

| Route | Method | Reader op | Input | Success | Error |
|-------|--------|-----------|-------|---------|-------|
| `/v1/get/:slug` | GET | `reader.get(slug)` | URL param | 200 + JSON | 404 if null, 500 on error |
| `/v1/get/:slug/:section` | GET | `reader.get(slug#section)` | URL params | 200 + JSON | 404 if null, 500 on error |
| `/v1/search?q=` | GET | `reader.search(q)` | query param | 200 + JSON[] | 400 if no q, 500 on error |
| `/v1/traverse/:from?type=&depth=` | GET | `reader.traverse(from, type, depth)` | URL + query params | 200 + JSON[] | 500 on error |
| `/v1/list?tags=` | GET | `reader.list({tags})` | query param (csv) | 200 + JSON[] | 500 on error |
| `*` (unmatched) | any | — | — | — | 404 |

### Multi-tenant endpoints

| Route | Method | Description | Success | Error |
|-------|--------|-------------|---------|-------|
| `/v1/tenants` | GET | List all tenants | 200 + JSON[] | — |
| `/v1/:tenant/get/:slug` | GET | Tenant-scoped get | 200 + JSON | 404 if null |
| `/v1/:tenant/get/:slug/:section` | GET | Tenant-scoped section get | 200 + JSON | 404 if null |
| `/v1/:tenant/search?q=` | GET | Tenant-scoped search | 200 + JSON[] | 400 if no q |
| `/v1/:tenant/traverse/:from` | GET | Tenant-scoped traverse | 200 + JSON[] | 500 on error |
| `/v1/:tenant/list?tags=` | GET | Tenant-scoped list | 200 + JSON[] | 500 on error |
| `/v1/:tenant/reload` | POST | Rebuild tenant | 200 + JSON | 500 on error |
| `/v1/reload` | POST | Rebuild default tenant | 200 + JSON | 500 on error |

### Routing disambiguation

The first path segment after `/v1/` is checked against known tenant names. If it matches a tenant, the request is routed to that tenant. Otherwise, it falls through to the default tenant.

See [[multi-tenant]] for the full routing algorithm.

### Response format

All responses: `Content-Type: application/json`, JSON pretty-printed with 2-space indent.

Error body: `{ "error": "<message>" }`

Success body: the Reader operation's return value serialized as JSON.

Reload success body: `{ "status": "ok", "report": { "total": n, "succeeded": n, "failed": [...] } }`

Tenants body: `[{ "name": "...", "sourceDir": "...", "artifactCount": n }]`

### Headers

Every response includes:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### CORS preflight

`OPTIONS` requests to any path return `204` with CORS headers.

## Laws

**A1. Endpoint-Reader isomorphism**: every endpoint returns exactly the JSON serialization of its corresponding Reader method's Ok value. No transformation, filtering, or enrichment.

**A2. Error mapping**: Reader Err → HTTP 500. Null result → HTTP 404. Missing required param → HTTP 400.

**A3. CORS universality**: every response carries CORS headers. No configuration needed for cross-origin consumers.

**A4. Tenant transparency**: tenant-scoped endpoints behave identically to their single-tenant counterparts, just routed to the correct Reader.

## Design rationale

**Why REST, not GraphQL?** Four fixed operations map cleanly to URL patterns. GraphQL adds query parsing for no gain when the query model is fixed.

**Why CORS by default?** Pramana is a local knowledge server. Frontend tools will call from localhost.

**Why POST for reload?** Reload mutates server state (rebuilds the tenant). GET is inappropriate for state-changing operations.
