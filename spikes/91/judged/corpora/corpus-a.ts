export type QueryEntry = {
  query: string;
  category: "exact" | "synonym" | "concept";
  relevant: string[];
  partiallyRelevant?: string[];
};

export const corpusPath = `${import.meta.dir}/../fixtures/corpus-a/`;
export const corpusName = "corpus-a";
export const corpusSlugs = [
  "api", "claude-plugin", "cli", "data-source", "engine",
  "knowledge-artifact", "multi-tenant", "parser", "pramana",
  "programming-model", "result-type", "storage", "tui",
];

export const queries: QueryEntry[] = [
  // === EXACT (18) ===
  {
    query: "FTS5 porter tokenizer",
    category: "exact",
    relevant: ["storage"],
    partiallyRelevant: ["pramana"],
  },
  {
    query: "StoragePlugin initialize close",
    category: "exact",
    relevant: ["programming-model", "storage"],
    partiallyRelevant: ["engine"],
  },
  {
    query: "Builder build sourceDir",
    category: "exact",
    relevant: ["engine"],
    partiallyRelevant: ["pramana", "programming-model"],
  },
  {
    query: "TenantManager mount reload getReader",
    category: "exact",
    relevant: ["multi-tenant", "engine"],
    partiallyRelevant: ["pramana"],
  },
  {
    query: "parseFrontmatter slug required",
    category: "exact",
    relevant: ["parser"],
    partiallyRelevant: ["knowledge-artifact"],
  },
  {
    query: "wikilinks relates-to depends-on",
    category: "exact",
    relevant: ["parser"],
    partiallyRelevant: ["knowledge-artifact", "programming-model"],
  },
  {
    query: "BFS traverse depth visited set",
    category: "exact",
    relevant: ["engine"],
    partiallyRelevant: ["programming-model"],
  },
  {
    query: "Result Ok Err discriminated union",
    category: "exact",
    relevant: ["result-type"],
    partiallyRelevant: ["programming-model"],
  },
  {
    query: "CORS Access-Control-Allow-Origin",
    category: "exact",
    relevant: ["api"],
  },
  {
    query: "ink React TUI views keybindings",
    category: "exact",
    relevant: ["tui"],
    partiallyRelevant: ["cli", "pramana"],
  },
  {
    query: "DataSource daemon standalone mode",
    category: "exact",
    relevant: ["data-source"],
    partiallyRelevant: ["tui", "cli"],
  },
  {
    query: "pramana serve --source --port",
    category: "exact",
    relevant: ["cli"],
    partiallyRelevant: ["multi-tenant", "claude-plugin"],
  },
  {
    query: "Claude Plugin skills setup query author",
    category: "exact",
    relevant: ["claude-plugin"],
    partiallyRelevant: ["pramana"],
  },
  {
    query: "SHA-256 hash content-addressable",
    category: "exact",
    relevant: ["knowledge-artifact"],
    partiallyRelevant: ["parser"],
  },
  {
    query: "Zod schema validation KnowledgeArtifactSchema",
    category: "exact",
    relevant: ["knowledge-artifact"],
    partiallyRelevant: ["programming-model"],
  },
  {
    query: "multi-tenant routing disambiguation",
    category: "exact",
    relevant: ["multi-tenant"],
    partiallyRelevant: ["api"],
  },
  {
    query: "search query snippet rank",
    category: "exact",
    relevant: ["programming-model", "storage"],
    partiallyRelevant: ["engine", "api"],
  },
  {
    query: "ArtifactView inverseRelationships focusedSection",
    category: "exact",
    relevant: ["knowledge-artifact"],
    partiallyRelevant: ["engine"],
  },

  // === SYNONYM (7) ===
  {
    query: "full-text indexing keywords",
    category: "synonym",
    relevant: ["storage"],
    partiallyRelevant: ["programming-model"],
  },
  {
    query: "namespace isolation per-tenant database",
    category: "synonym",
    relevant: ["multi-tenant"],
    partiallyRelevant: ["engine", "pramana"],
  },
  {
    query: "markdown frontmatter YAML extraction",
    category: "synonym",
    relevant: ["parser"],
    partiallyRelevant: ["knowledge-artifact"],
  },
  {
    query: "HTTP REST endpoints JSON responses",
    category: "synonym",
    relevant: ["api"],
    partiallyRelevant: ["cli", "data-source"],
  },
  {
    query: "terminal interactive interface keyboard navigation",
    category: "synonym",
    relevant: ["tui"],
    partiallyRelevant: ["cli"],
  },
  {
    query: "error handling without exceptions typed wrapper",
    category: "synonym",
    relevant: ["result-type"],
    partiallyRelevant: ["programming-model"],
  },
  {
    query: "graph edges relationships directed connections",
    category: "synonym",
    relevant: ["programming-model"],
    partiallyRelevant: ["engine", "knowledge-artifact"],
  },

  // === CONCEPT (5) ===
  {
    query: "how does pramana rebuild the database on every startup",
    category: "concept",
    relevant: ["engine", "pramana"],
    partiallyRelevant: ["cli", "storage"],
  },
  {
    query: "what happens when a search query is issued through the API",
    category: "concept",
    relevant: ["api", "engine"],
    partiallyRelevant: ["storage", "programming-model"],
  },
  {
    query: "how are multiple knowledge bases served from a single process",
    category: "concept",
    relevant: ["multi-tenant"],
    partiallyRelevant: ["engine", "cli", "pramana"],
  },
  {
    query: "what is the relationship between the TUI and the data layer",
    category: "concept",
    relevant: ["data-source", "tui"],
    partiallyRelevant: ["engine", "cli"],
  },
  {
    query: "how does Claude interact with the knowledge engine",
    category: "concept",
    relevant: ["claude-plugin"],
    partiallyRelevant: ["cli", "api", "pramana"],
  },
];
