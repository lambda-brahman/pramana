---
slug: user-service
title: User Service
tags: [service, core]
relationships:
  relates-to: [auth-service]
---

# User Service

The user service manages user accounts, profiles, and preferences. It is the source of truth for user identity within the system.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Create a new user account |
| GET | `/users/:id` | Get user by ID |
| GET | `/users?email=<email>` | Look up user by email |
| PUT | `/users/:id` | Update user profile |
| DELETE | `/users/:id` | Soft-delete a user account |
| GET | `/users/:id/preferences` | Get user preferences |
| PUT | `/users/:id/preferences` | Update user preferences |

## Data Model

```
User {
  id:          UUID (primary key)
  email:       string (unique, indexed)
  name:        string
  role:        enum [user, admin]
  status:      enum [active, suspended, deleted]
  created_at:  timestamp
  updated_at:  timestamp
}

Preferences {
  user_id:     UUID (foreign key -> User.id)
  theme:       enum [light, dark, system]
  locale:      string (e.g., "en-US")
  timezone:    string (e.g., "America/New_York")
  notifications: JSON
}
```

Passwords are not stored in the user service. The [[relates-to::auth-service]] handles credential storage and verification separately.

## Events

The user service publishes events for other services to react to:

| Event | Payload | When |
|-------|---------|------|
| `user.created` | `{ id, email, role }` | New account created |
| `user.updated` | `{ id, changes }` | Profile or role changed |
| `user.deleted` | `{ id }` | Account soft-deleted |
| `user.suspended` | `{ id, reason }` | Account suspended |

Events are published to a message queue. Consumers include the auth service (to revoke tokens on suspension/deletion) and the notification service.
