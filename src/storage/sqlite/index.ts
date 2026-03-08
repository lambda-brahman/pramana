import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../../lib/result.ts";
import type { KnowledgeArtifact, Relationship, RelationshipType } from "../../schema/index.ts";
import type { Embedder } from "../embedder.ts";
import { EmbeddingIndex } from "../embedding-index.ts";
import { orQuery } from "../fts5-preprocessor.ts";
import type { SearchResult, StorageError, StoragePlugin } from "../interface.ts";
import { type RankedResult, rrf } from "../rrf.ts";

const DDL = `
  CREATE TABLE IF NOT EXISTS artifacts (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    aliases TEXT,
    tags TEXT NOT NULL,
    content TEXT NOT NULL,
    hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS relationships (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    line INTEGER,
    section TEXT,
    FOREIGN KEY (source) REFERENCES artifacts(slug)
  );

  CREATE TABLE IF NOT EXISTS sections (
    artifact_slug TEXT NOT NULL,
    id TEXT NOT NULL,
    heading TEXT NOT NULL,
    level INTEGER NOT NULL,
    line INTEGER NOT NULL,
    FOREIGN KEY (artifact_slug) REFERENCES artifacts(slug)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
    slug,
    title,
    summary,
    aliases,
    content,
    tokenize='porter unicode61'
  );

  CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source);
  CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target);
  CREATE INDEX IF NOT EXISTS idx_sections_slug ON sections(artifact_slug);
`;

export class SqlitePlugin implements StoragePlugin {
  private db: Database;
  private embeddingIndex: EmbeddingIndex | null = null;
  private embedder: Embedder | null = null;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
  }

  initialize(): Result<void, StorageError> {
    try {
      this.db.exec("PRAGMA journal_mode=WAL;");
      this.db.exec(DDL);
      return ok(undefined);
    } catch (e) {
      return err({ type: "storage", message: `Init failed: ${errorMsg(e)}` });
    }
  }

  store(artifact: KnowledgeArtifact): Result<void, StorageError> {
    try {
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO artifacts (slug, title, summary, aliases, tags, content, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            artifact.slug,
            artifact.title,
            artifact.summary ?? null,
            artifact.aliases ? JSON.stringify(artifact.aliases) : null,
            JSON.stringify(artifact.tags),
            artifact.content,
            artifact.hash,
          );

        this.db.prepare(`DELETE FROM relationships WHERE source = ?`).run(artifact.slug);
        const insertRel = this.db.prepare(
          `INSERT INTO relationships (source, target, type, line, section)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const rel of artifact.relationships) {
          insertRel.run(artifact.slug, rel.target, rel.type, rel.line ?? null, rel.section ?? null);
        }

        this.db.prepare(`DELETE FROM sections WHERE artifact_slug = ?`).run(artifact.slug);
        const insertSec = this.db.prepare(
          `INSERT INTO sections (artifact_slug, id, heading, level, line)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const sec of artifact.sections) {
          insertSec.run(artifact.slug, sec.id, sec.heading, sec.level, sec.line);
        }

        this.db.prepare(`DELETE FROM artifacts_fts WHERE slug = ?`).run(artifact.slug);
        this.db
          .prepare(
            `INSERT INTO artifacts_fts (slug, title, summary, aliases, content) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            artifact.slug,
            artifact.title,
            artifact.summary ?? "",
            artifact.aliases?.join(" ") ?? "",
            artifact.content,
          );
      });

      tx();
      return ok(undefined);
    } catch (e) {
      return err({ type: "storage", message: `Store failed: ${errorMsg(e)}` });
    }
  }

  get(slug: string): Result<KnowledgeArtifact | null, StorageError> {
    try {
      const row = this.db
        .prepare(
          `SELECT slug, title, summary, aliases, tags, content, hash FROM artifacts WHERE slug = ?`,
        )
        .get(slug) as ArtifactRow | null;

      if (!row) return ok(null);

      const relationships = this.db
        .prepare(`SELECT target, type, line, section FROM relationships WHERE source = ?`)
        .all(slug) as RelRow[];

      const sections = this.db
        .prepare(`SELECT id, heading, level, line FROM sections WHERE artifact_slug = ?`)
        .all(slug) as SecRow[];

      return ok(toArtifact(row, relationships, sections));
    } catch (e) {
      return err({ type: "storage", message: `Get failed: ${errorMsg(e)}` });
    }
  }

  list(filter?: { tags?: string[] }): Result<KnowledgeArtifact[], StorageError> {
    try {
      let rows: ArtifactRow[];

      if (filter?.tags && filter.tags.length > 0) {
        rows = this.db
          .prepare(`SELECT slug, title, summary, aliases, tags, content, hash FROM artifacts`)
          .all() as ArtifactRow[];

        rows = rows.filter((row) => {
          const rowTags = JSON.parse(row.tags) as string[];
          return filter.tags!.every((t) => rowTags.includes(t));
        });
      } else {
        rows = this.db
          .prepare(`SELECT slug, title, summary, aliases, tags, content, hash FROM artifacts`)
          .all() as ArtifactRow[];
      }

      const artifacts: KnowledgeArtifact[] = [];
      for (const row of rows) {
        const relationships = this.db
          .prepare(`SELECT target, type, line, section FROM relationships WHERE source = ?`)
          .all(row.slug) as RelRow[];
        const sections = this.db
          .prepare(`SELECT id, heading, level, line FROM sections WHERE artifact_slug = ?`)
          .all(row.slug) as SecRow[];
        artifacts.push(toArtifact(row, relationships, sections));
      }

      return ok(artifacts);
    } catch (e) {
      return err({ type: "storage", message: `List failed: ${errorMsg(e)}` });
    }
  }

  getRelationships(slug: string): Result<Relationship[], StorageError> {
    try {
      const rows = this.db
        .prepare(`SELECT target, type, line, section FROM relationships WHERE source = ?`)
        .all(slug) as RelRow[];

      return ok(rows.map(toRelationship));
    } catch (e) {
      return err({ type: "storage", message: `GetRelationships failed: ${errorMsg(e)}` });
    }
  }

  getInverse(slug: string): Result<Relationship[], StorageError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT source as target, type, line, section FROM relationships WHERE target = ? OR target LIKE ?`,
        )
        .all(slug, `${slug}#%`) as RelRow[];

      return ok(rows.map(toRelationship));
    } catch (e) {
      return err({ type: "storage", message: `GetInverse failed: ${errorMsg(e)}` });
    }
  }

  async search(query: string): Promise<Result<SearchResult[], StorageError>> {
    try {
      // 1. FTS5-OR search
      const ftsRows = this.db
        .prepare(
          `SELECT f.slug, f.title,
                  snippet(artifacts_fts, -1, '<mark>', '</mark>', '...', 64) as snippet,
                  f.rank,
                  a.summary
           FROM artifacts_fts f
           JOIN artifacts a ON a.slug = f.slug
           WHERE artifacts_fts MATCH ?
           ORDER BY f.rank`,
        )
        .all(orQuery(query)) as FtsRow[];

      const ftsResults: SearchResult[] = ftsRows.map((r) => ({
        slug: r.slug,
        title: r.title,
        ...(r.summary ? { summary: r.summary } : {}),
        snippet: r.snippet,
        rank: r.rank,
      }));

      // 2. If no embedding index available, return FTS-only results
      if (!this.embeddingIndex || !this.embedder) {
        return ok(ftsResults);
      }

      // 3. Semantic search
      let semanticRanked: RankedResult[];
      try {
        const queryVec = await this.embedder.embed(query, true);
        semanticRanked = this.embeddingIndex.search(queryVec, 20);
      } catch {
        // Embed failure: fall back to FTS-only
        return ok(ftsResults);
      }

      // 4. Build ranked lists for RRF
      const ftsRanked: RankedResult[] = ftsResults.map((r) => ({
        slug: r.slug,
        score: -r.rank,
      }));

      const listResult = this.list();
      const totalDocs = listResult.ok ? listResult.value.length : ftsResults.length;
      const fused = rrf([ftsRanked, semanticRanked], 10, totalDocs);

      // 5. Build final SearchResult[] with snippets
      const ftsSnippetMap = new Map<string, SearchResult>();
      for (const r of ftsResults) {
        ftsSnippetMap.set(r.slug, r);
      }

      const results: SearchResult[] = [];
      for (let i = 0; i < fused.length; i++) {
        const item = fused[i]!;
        const ftsHit = ftsSnippetMap.get(item.slug);

        if (ftsHit) {
          results.push({ ...ftsHit, rank: i + 1 });
        } else {
          // Semantic-only hit: build snippet from artifact
          const artifact = this.get(item.slug);
          if (artifact.ok && artifact.value) {
            results.push({
              slug: item.slug,
              title: artifact.value.title,
              ...(artifact.value.summary ? { summary: artifact.value.summary } : {}),
              snippet: artifact.value.summary ?? artifact.value.content.slice(0, 200),
              rank: i + 1,
            });
          }
        }
      }

      return ok(results);
    } catch (e) {
      return err({ type: "storage", message: `Search failed: ${errorMsg(e)}` });
    }
  }

  async buildEmbeddings(
    embedder: Embedder,
  ): Promise<Result<{ count: number; timeMs: number }, StorageError>> {
    try {
      const start = performance.now();
      const listResult = this.list();
      if (!listResult.ok) return err(listResult.error);

      const index = new EmbeddingIndex();
      for (const artifact of listResult.value) {
        const text = `${artifact.title}. ${artifact.summary ?? ""}. ${artifact.content.slice(0, 512)}`;
        const vector = await embedder.embed(text);
        index.add(artifact.slug, vector);
      }

      this.embeddingIndex = index;
      this.embedder = embedder;
      const timeMs = performance.now() - start;

      return ok({ count: index.size, timeMs });
    } catch (e) {
      return err({ type: "storage", message: `BuildEmbeddings failed: ${errorMsg(e)}` });
    }
  }

  close(): Result<void, StorageError> {
    try {
      this.db.close();
      return ok(undefined);
    } catch (e) {
      return err({ type: "storage", message: `Close failed: ${errorMsg(e)}` });
    }
  }
}

type ArtifactRow = {
  slug: string;
  title: string;
  summary: string | null;
  aliases: string | null;
  tags: string;
  content: string;
  hash: string;
};

type RelRow = {
  target: string;
  type: string;
  line: number | null;
  section: string | null;
};

type SecRow = {
  id: string;
  heading: string;
  level: number;
  line: number;
};

type FtsRow = {
  slug: string;
  title: string;
  snippet: string;
  rank: number;
  summary: string | null;
};

function toArtifact(row: ArtifactRow, rels: RelRow[], secs: SecRow[]): KnowledgeArtifact {
  return {
    slug: row.slug,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.aliases ? { aliases: JSON.parse(row.aliases) as string[] } : {}),
    tags: JSON.parse(row.tags),
    content: row.content,
    hash: row.hash,
    relationships: rels.map(toRelationship),
    sections: secs.map((s) => ({
      id: s.id,
      heading: s.heading,
      level: s.level,
      line: s.line,
    })),
  };
}

function toRelationship(row: RelRow): Relationship {
  return {
    target: row.target,
    type: row.type as RelationshipType,
    ...(row.line != null ? { line: row.line } : {}),
    ...(row.section != null ? { section: row.section } : {}),
  };
}

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
