---
slug: api
title: HTTP API
tags: [api, module]
relationships:
  depends-on: [pramana, engine]
---

# HTTP API

## Specification

Read-only JSON API. Each endpoint maps to a Reader operation.

```
Server(port: nat, reader: Reader) → HTTPServer
```

### Endpoints

| Route | Method | Reader op | Input | Success | Error |
|-------|--------|-----------|-------|---------|-------|
| `/v1/get/:slug` | GET | `reader.get(slug)` | URL param | 200 + JSON | 404 if null, 500 on error |
| `/v1/get/:slug/:section` | GET | `reader.get(slug#section)` | URL params | 200 + JSON | 404 if null, 500 on error |
| `/v1/search?q=` | GET | `reader.search(q)` | query param | 200 + JSON[] | 400 if no q, 500 on error |
| `/v1/traverse/:from?type=&depth=` | GET | `reader.traverse(from, type, depth)` | URL + query params | 200 + JSON[] | 500 on error |
| `/v1/list?tags=` | GET | `reader.list({tags})` | query param (csv) | 200 + JSON[] | 500 on error |
| `*` (unmatched) | any | — | — | — | 404 |

### Response format

All responses: `Content-Type: application/json`, JSON pretty-printed with 2-space indent.

Error body: `{ "error": "<message>" }`

Success body: the Reader operation's return value serialized as JSON.

### Headers

Every response includes:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### Section-based get

`/v1/get/:slug/:section` is handled by a fallback `fetch` handler (not a route definition) because Bun's route matching doesn't support multi-segment params. The handler matches `/v1/get/([^/]+)/(.+)$` via regex, concatenates as `slug#section`, then calls `reader.get()`.

## Laws

**A1. Endpoint-Reader isomorphism**: every endpoint returns exactly the JSON serialization of its corresponding Reader method's Ok value. No transformation, filtering, or enrichment.

**A2. Error mapping**: Reader Err → HTTP 500. Null result → HTTP 404. Missing required param → HTTP 400.

**A3. CORS universality**: every response carries CORS headers. No configuration needed for cross-origin consumers.

## Design rationale

**Why REST, not GraphQL?** Four fixed operations map cleanly to URL patterns. GraphQL adds query parsing for no gain when the query model is fixed.

**Why CORS by default?** Pramana is a local knowledge server. Frontend tools will call from localhost.
