import type { Result } from "../lib/result.ts";
import type { KnowledgeArtifact, Relationship } from "../schema/index.ts";

export type StorageError = { type: "storage"; message: string };

export type SearchResult = {
  slug: string;
  title: string;
  summary?: string;
  snippet: string;
  rank: number;
};

export interface StorageWriter {
  store(artifact: KnowledgeArtifact): Result<void, StorageError>;
}

export interface StorageReader {
  get(slug: string): Result<KnowledgeArtifact | null, StorageError>;
  list(filter?: { tags?: string[] }): Result<KnowledgeArtifact[], StorageError>;
  getRelationships(slug: string): Result<Relationship[], StorageError>;
  getInverse(slug: string): Result<Relationship[], StorageError>;
}

export interface StorageSearcher {
  search(query: string): Promise<Result<SearchResult[], StorageError>>;
}

export interface StoragePlugin extends StorageWriter, StorageReader, StorageSearcher {
  initialize(): Result<void, StorageError>;
  close(): Result<void, StorageError>;
}
