export type QueryEntry = {
  query: string;
  category: "exact" | "synonym" | "concept";
  relevant: string[];
  partiallyRelevant?: string[];
};

export const corpusPath = `${import.meta.dir}/../fixtures/corpus-b/`;
export const corpusName = "corpus-b";
export const corpusSlugs = [
  "create-user", "delete-user", "get-user", "list-users",
  "update-user-role", "validate-email", "check-active-sessions",
  "check-last-admin", "check-rate-limit", "permissions",
];

export const queries: QueryEntry[] = [
  // === EXACT (18) ===
  {
    query: "POST /api/users create",
    category: "exact",
    relevant: ["create-user"],
    partiallyRelevant: ["permissions"],
  },
  {
    query: "DELETE /api/users/:id",
    category: "exact",
    relevant: ["delete-user"],
    partiallyRelevant: ["check-active-sessions"],
  },
  {
    query: "GET /api/users/:id email",
    category: "exact",
    relevant: ["get-user"],
    partiallyRelevant: ["list-users"],
  },
  {
    query: "list users role filter limit offset",
    category: "exact",
    relevant: ["list-users"],
    partiallyRelevant: ["get-user"],
  },
  {
    query: "PATCH /api/users/:id/role",
    category: "exact",
    relevant: ["update-user-role"],
    partiallyRelevant: ["permissions"],
  },
  {
    query: "validate email RFC 5322 MX records",
    category: "exact",
    relevant: ["validate-email"],
    partiallyRelevant: ["create-user"],
  },
  {
    query: "check active sessions non-expired",
    category: "exact",
    relevant: ["check-active-sessions"],
    partiallyRelevant: ["delete-user"],
  },
  {
    query: "check last admin zero admin users",
    category: "exact",
    relevant: ["check-last-admin"],
    partiallyRelevant: ["update-user-role"],
  },
  {
    query: "rate limit requests per minute sliding window",
    category: "exact",
    relevant: ["check-rate-limit"],
  },
  {
    query: "users:write users:read users:delete permission",
    category: "exact",
    relevant: ["permissions"],
    partiallyRelevant: ["create-user", "delete-user"],
  },
  {
    query: "force flag skip active session check",
    category: "exact",
    relevant: ["delete-user"],
    partiallyRelevant: ["check-active-sessions"],
  },
  {
    query: "cannot delete last admin user",
    category: "exact",
    relevant: ["delete-user", "check-last-admin"],
    partiallyRelevant: ["update-user-role"],
  },
  {
    query: "email already_exists invalid_format",
    category: "exact",
    relevant: ["validate-email"],
  },
  {
    query: "admin member viewer role",
    category: "exact",
    relevant: ["create-user", "update-user-role", "list-users"],
    partiallyRelevant: ["permissions"],
  },
  {
    query: "204 No Content on success",
    category: "exact",
    relevant: ["delete-user"],
  },
  {
    query: "rate_limited retry_after_seconds",
    category: "exact",
    relevant: ["check-rate-limit"],
  },
  {
    query: "audit logged role changes recorded",
    category: "exact",
    relevant: ["update-user-role"],
  },
  {
    query: "10 creations per minute per API key",
    category: "exact",
    relevant: ["create-user"],
    partiallyRelevant: ["check-rate-limit"],
  },

  // === SYNONYM (7) ===
  {
    query: "register new account",
    category: "synonym",
    relevant: ["create-user"],
    partiallyRelevant: ["validate-email"],
  },
  {
    query: "remove user permanently irreversible",
    category: "synonym",
    relevant: ["delete-user"],
    partiallyRelevant: ["check-active-sessions"],
  },
  {
    query: "fetch user profile by identifier",
    category: "synonym",
    relevant: ["get-user"],
  },
  {
    query: "change user access level",
    category: "synonym",
    relevant: ["update-user-role"],
    partiallyRelevant: ["permissions", "check-last-admin"],
  },
  {
    query: "verify email address format and domain",
    category: "synonym",
    relevant: ["validate-email"],
  },
  {
    query: "throttle API calls abuse prevention",
    category: "synonym",
    relevant: ["check-rate-limit"],
  },
  {
    query: "authorization access control security model",
    category: "synonym",
    relevant: ["permissions"],
    partiallyRelevant: ["update-user-role"],
  },

  // === CONCEPT (5) ===
  {
    query: "what steps happen before a user can be deleted",
    category: "concept",
    relevant: ["delete-user"],
    partiallyRelevant: ["check-active-sessions", "check-last-admin", "get-user"],
  },
  {
    query: "how does the system prevent having no administrators",
    category: "concept",
    relevant: ["check-last-admin"],
    partiallyRelevant: ["update-user-role", "delete-user"],
  },
  {
    query: "what permissions are needed to manage users",
    category: "concept",
    relevant: ["permissions"],
    partiallyRelevant: ["create-user", "delete-user", "update-user-role"],
  },
  {
    query: "how is email uniqueness enforced during signup",
    category: "concept",
    relevant: ["validate-email", "create-user"],
  },
  {
    query: "what safety checks protect against destructive operations",
    category: "concept",
    relevant: ["check-active-sessions", "check-last-admin"],
    partiallyRelevant: ["delete-user", "check-rate-limit"],
  },
];
