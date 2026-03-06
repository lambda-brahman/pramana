---
slug: api
title: HTTP API
tags: [api, module]
relationships:
  depends-on: [pramana, reader]
---

# HTTP API

A read-only JSON API served via `Bun.serve()`. All endpoints return JSON with CORS headers enabled.

## Endpoints

- `GET /v1/get/:slug` — retrieve artifact by slug
- `GET /v1/get/:slug/:section` — retrieve artifact focused on a section
- `GET /v1/search?q=<query>` — full-text search
- `GET /v1/traverse/:from?type=<rel>&depth=<n>` — graph traversal
- `GET /v1/list?tags=<t1,t2>` — list artifacts with optional tag filter

## Section-based get

The `/v1/get/:slug/:section` route is handled by a fallback `fetch` handler since Bun's route-based matching doesn't support multi-segment params. It concatenates slug and section as `slug#section-id` before calling [[reader]] get.

## Error responses

Errors are returned as `{ "error": "message" }` with appropriate HTTP status codes (400, 404, 500).
