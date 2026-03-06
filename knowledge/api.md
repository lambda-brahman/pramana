---
slug: api
title: HTTP API
tags: [api, module]
relationships:
  depends-on: [pramana, engine]
---

# HTTP API

Read-only JSON API served via `Bun.serve()`. Maps HTTP routes to Reader primitives.

## Why this design

**Why JSON, not GraphQL?**
The four primitives (get, search, traverse, list) map cleanly to REST endpoints. GraphQL adds query parsing complexity for no gain when the query model is already fixed. Standard REST decision — see API design literature.

**Why CORS enabled by default?**
Pramana is a local knowledge server. Frontend tools (dashboards, editors) will call it from `localhost`. Requiring CORS configuration would be a papercut for every consumer.

**Why section-based get uses a fallback handler?**
`Bun.serve()` route matching doesn't support multi-segment params (`/v1/get/:slug/:section`). The fallback `fetch` handler catches this pattern via regex. This is a Bun-specific workaround, not a design choice.

## Endpoints

All map directly to [[engine]] Reader methods:

| Endpoint | Reader method | Notes |
|----------|--------------|-------|
| `GET /v1/get/:slug` | `reader.get(slug)` | 404 if not found |
| `GET /v1/get/:slug/:section` | `reader.get(slug#section)` | Fallback handler |
| `GET /v1/search?q=` | `reader.search(q)` | 400 if no query |
| `GET /v1/traverse/:from?type=&depth=` | `reader.traverse(from, type, depth)` | |
| `GET /v1/list?tags=` | `reader.list({tags})` | |

## Invariants

| Invariant | Why | Implementation | Test |
|-----------|-----|----------------|------|
| Missing query param on search returns 400 | Not a server error, client must provide q | `src/api/server.ts:22` | `test/e2e/api.test.ts` > "GET /v1/search without q returns 400" |
| Unknown routes return 404 | Clean error handling | `src/api/server.ts:52-65` — fallback fetch | `test/e2e/api.test.ts` > "unknown route returns 404" |
| CORS headers on every response | All consumers can call without proxy | `src/api/server.ts:71-74` | `test/e2e/api.test.ts` > "CORS headers present" |
