/**
 * Query set with ground-truth relevant slugs for benchmarking.
 *
 * Three categories:
 * 1. exact    — uses domain vocabulary, slug names, or precise terms
 * 2. synonym  — paraphrases / alternative phrasing for the same concept
 * 3. concept  — intent-based queries where the caller lacks domain vocabulary
 */

export type QueryEntry = {
  query: string;
  category: "exact" | "synonym" | "concept";
  relevant: string[]; // ground-truth slugs that should be returned
};

export const QUERY_SET: QueryEntry[] = [
  // ── Exact keyword queries ─────────────────────────────────────────────
  {
    query: "StoragePlugin",
    category: "exact",
    relevant: ["storage", "programming-model", "engine"],
  },
  {
    query: "FTS5 full text search",
    category: "exact",
    relevant: ["storage"],
  },
  {
    query: "TenantManager",
    category: "exact",
    relevant: ["multi-tenant", "engine"],
  },
  {
    query: "wikilink parser",
    category: "exact",
    relevant: ["parser", "knowledge-artifact"],
  },
  {
    query: "Result type error handling",
    category: "exact",
    relevant: ["result-type", "programming-model"],
  },
  {
    query: "Builder build",
    category: "exact",
    relevant: ["engine"],
  },
  {
    query: "ink React terminal",
    category: "exact",
    relevant: ["tui"],
  },
  {
    query: "CORS JSON API",
    category: "exact",
    relevant: ["api"],
  },
  {
    query: "Zod schema validation",
    category: "exact",
    relevant: ["knowledge-artifact", "parser"],
  },
  {
    query: "slug frontmatter",
    category: "exact",
    relevant: ["knowledge-artifact", "parser"],
  },

  // ── Synonym / paraphrase queries ──────────────────────────────────────
  {
    query: "data model core type",
    category: "synonym",
    relevant: ["knowledge-artifact", "programming-model"],
  },
  {
    query: "markdown to structured data pipeline",
    category: "synonym",
    relevant: ["parser", "engine", "pramana"],
  },
  {
    query: "database backend persistence layer",
    category: "synonym",
    relevant: ["storage"],
  },
  {
    query: "command line tool interface",
    category: "synonym",
    relevant: ["cli"],
  },
  {
    query: "web server HTTP endpoints",
    category: "synonym",
    relevant: ["api"],
  },
  {
    query: "namespace isolation multiple knowledge bases",
    category: "synonym",
    relevant: ["multi-tenant"],
  },
  {
    query: "graph walk relationship following",
    category: "synonym",
    relevant: ["engine", "programming-model"],
  },
  {
    query: "terminal user interface interactive display",
    category: "synonym",
    relevant: ["tui"],
  },
  {
    query: "AI assistant integration",
    category: "synonym",
    relevant: ["claude-plugin"],
  },
  {
    query: "transport abstraction network vs local",
    category: "synonym",
    relevant: ["data-source"],
  },

  // ── Conceptual / intent queries ───────────────────────────────────────
  {
    query: "how does search work",
    category: "concept",
    relevant: ["storage", "engine", "programming-model"],
  },
  {
    query: "how are markdown files converted to queryable knowledge",
    category: "concept",
    relevant: ["parser", "engine", "pramana"],
  },
  {
    query: "what guarantees does the system provide",
    category: "concept",
    relevant: ["programming-model", "result-type"],
  },
  {
    query: "how do I add a new knowledge base",
    category: "concept",
    relevant: ["multi-tenant", "cli", "engine"],
  },
  {
    query: "what happens when an artifact is stored",
    category: "concept",
    relevant: ["storage", "engine", "programming-model"],
  },
  {
    query: "how does the system handle errors and failures",
    category: "concept",
    relevant: ["result-type", "programming-model"],
  },
  {
    query: "how can I browse artifacts visually",
    category: "concept",
    relevant: ["tui", "cli"],
  },
  {
    query: "how does Claude access domain knowledge",
    category: "concept",
    relevant: ["claude-plugin", "pramana"],
  },
  {
    query: "what is the relationship between artifacts",
    category: "concept",
    relevant: ["knowledge-artifact", "engine", "programming-model"],
  },
  {
    query: "how does the system start up and serve requests",
    category: "concept",
    relevant: ["cli", "api", "engine", "pramana"],
  },
];
