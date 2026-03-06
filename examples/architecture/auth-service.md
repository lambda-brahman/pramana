---
slug: auth-service
title: Auth Service
tags: [service, security]
relationships:
  relates-to: [user-service]
---

# Auth Service

The auth service handles authentication and token management. It verifies credentials, issues JWTs, and validates tokens for other services.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Authenticate with email/password, returns access + refresh tokens |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| POST | `/auth/logout` | Revoke a refresh token |
| GET | `/auth/validate` | Validate an access token (used by the API gateway) |
| POST | `/auth/api-keys` | Create an API key for service-to-service auth |

## Token Flow

1. **Login:** Client sends credentials to `/auth/login`. The auth service verifies against the [[relates-to::user-service]] user store. On success, returns an access token (short-lived) and a refresh token (long-lived).

2. **Access:** Client includes the access token in the `Authorization: Bearer <token>` header. The API gateway calls `/auth/validate` on every request.

3. **Refresh:** When the access token expires, the client sends the refresh token to `/auth/refresh` to get a new access token without re-entering credentials.

4. **Logout:** Client sends the refresh token to `/auth/logout`. The token is added to a revocation list.

### Token details

| Token | Lifetime | Storage | Revocable |
|-------|----------|---------|-----------|
| Access token | 15 minutes | Client only (JWT) | No (short-lived by design) |
| Refresh token | 7 days | Server-side + client | Yes (explicit revocation) |
| API key | Until revoked | Server-side | Yes |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `jwt_secret` | (required) | Secret key for signing JWTs |
| `access_token_ttl` | 15m | Access token lifetime |
| `refresh_token_ttl` | 7d | Refresh token lifetime |
| `bcrypt_rounds` | 12 | Password hashing cost |
| `max_login_attempts` | 5 | Lockout after N failed attempts |
| `lockout_duration` | 15m | How long a locked account stays locked |
