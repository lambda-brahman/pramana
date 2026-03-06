import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../../lib/result.ts";
import type { KnowledgeArtifact, Relationship, RelationshipType } from "../../schema/index.ts";
import type { SearchResult, StorageError, StoragePlugin } from "../interface.ts";

const DDL = `
  CREATE TABLE IF NOT EXISTS artifacts (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
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
    content,
    tokenize='porter unicode61'
  );

  CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source);
  CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target);
  CREATE INDEX IF NOT EXISTS idx_sections_slug ON sections(artifact_slug);
`;

export class SqlitePlugin implements StoragePlugin {
  private db: Database;

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
            `INSERT OR REPLACE INTO artifacts (slug, title, tags, content, hash)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            artifact.slug,
            artifact.title,
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
          .prepare(`INSERT INTO artifacts_fts (slug, title, content) VALUES (?, ?, ?)`)
          .run(artifact.slug, artifact.title, artifact.content);
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
        .prepare(`SELECT slug, title, tags, content, hash FROM artifacts WHERE slug = ?`)
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
          .prepare(`SELECT slug, title, tags, content, hash FROM artifacts`)
          .all() as ArtifactRow[];

        rows = rows.filter((row) => {
          const rowTags = JSON.parse(row.tags) as string[];
          return filter.tags!.every((t) => rowTags.includes(t));
        });
      } else {
        rows = this.db
          .prepare(`SELECT slug, title, tags, content, hash FROM artifacts`)
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

  search(query: string): Result<SearchResult[], StorageError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT slug, title, snippet(artifacts_fts, 2, '<mark>', '</mark>', '...', 64) as snippet,
                  rank
           FROM artifacts_fts
           WHERE artifacts_fts MATCH ?
           ORDER BY rank`,
        )
        .all(query) as FtsRow[];

      return ok(
        rows.map((r) => ({
          slug: r.slug,
          title: r.title,
          snippet: r.snippet,
          rank: r.rank,
        })),
      );
    } catch (e) {
      return err({ type: "storage", message: `Search failed: ${errorMsg(e)}` });
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
};

function toArtifact(row: ArtifactRow, rels: RelRow[], secs: SecRow[]): KnowledgeArtifact {
  return {
    slug: row.slug,
    title: row.title,
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
