use crate::error::{StorageError, StorageResult};
use crate::fts::{or_query, NoOpFilter, StopWordFilter};
use crate::model::{Artifact, RankedResult, Relationship, SearchResult, Section};
use crate::{rrf, schema};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::sync::Once;
use zerocopy::AsBytes;

pub struct Storage {
    conn: Connection,
    stop_word_filter: Box<dyn StopWordFilter>,
    embedding_dim: usize,
}

impl Storage {
    pub fn open(path: &str) -> StorageResult<Self> {
        Self::open_with_options(path, Box::new(NoOpFilter), 384)
    }

    pub fn open_with_options(
        path: &str,
        stop_word_filter: Box<dyn StopWordFilter>,
        embedding_dim: usize,
    ) -> StorageResult<Self> {
        register_sqlite_vec();
        let conn = Connection::open(path)?;
        Ok(Storage {
            conn,
            stop_word_filter,
            embedding_dim,
        })
    }

    pub fn initialize(&self) -> StorageResult<()> {
        self.conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        self.conn.execute_batch(schema::DDL)?;
        self.conn
            .execute_batch(&schema::vec0_ddl(self.embedding_dim))?;
        Ok(())
    }

    pub fn insert_artifact(&self, artifact: &Artifact) -> StorageResult<()> {
        let tx = self.conn.unchecked_transaction()?;

        let aliases_json: Option<String> = artifact
            .aliases
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let tags_json = serde_json::to_string(&artifact.tags)?;

        tx.execute(
            "INSERT OR REPLACE INTO artifacts (slug, title, summary, aliases, tags, content, hash) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                artifact.slug,
                artifact.title,
                artifact.summary,
                aliases_json,
                tags_json,
                artifact.content,
                artifact.hash,
            ],
        )?;

        tx.execute(
            "DELETE FROM relationships WHERE source = ?",
            params![artifact.slug],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO relationships (source, target, type, line, section) \
                 VALUES (?, ?, ?, ?, ?)",
            )?;
            for rel in &artifact.relationships {
                stmt.execute(params![
                    artifact.slug,
                    rel.target,
                    rel.kind,
                    rel.line,
                    rel.section
                ])?;
            }
        }

        tx.execute(
            "DELETE FROM sections WHERE artifact_slug = ?",
            params![artifact.slug],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO sections (artifact_slug, id, heading, level, line) \
                 VALUES (?, ?, ?, ?, ?)",
            )?;
            for sec in &artifact.sections {
                stmt.execute(params![
                    artifact.slug,
                    sec.id,
                    sec.heading,
                    sec.level,
                    sec.line
                ])?;
            }
        }

        tx.execute(
            "DELETE FROM artifacts_fts WHERE slug = ?",
            params![artifact.slug],
        )?;
        tx.execute(
            "INSERT INTO artifacts_fts (slug, title, summary, aliases, content) \
             VALUES (?, ?, ?, ?, ?)",
            params![
                artifact.slug,
                artifact.title,
                artifact.summary.as_deref().unwrap_or(""),
                artifact
                    .aliases
                    .as_ref()
                    .map(|a| a.join(" "))
                    .unwrap_or_default(),
                artifact.content,
            ],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn get(&self, slug: &str) -> StorageResult<Option<Artifact>> {
        let mut stmt = self.conn.prepare(
            "SELECT slug, title, summary, aliases, tags, content, hash \
             FROM artifacts WHERE slug = ?",
        )?;
        let rows: Vec<ArtifactRow> = stmt
            .query_map(params![slug], map_artifact_row)?
            .collect::<Result<_, _>>()?;

        match rows.into_iter().next() {
            Some(row) => Ok(Some(self.hydrate_artifact(row)?)),
            None => Ok(None),
        }
    }

    pub fn list(&self, tags: Option<&[String]>) -> StorageResult<Vec<Artifact>> {
        let mut stmt = self
            .conn
            .prepare("SELECT slug, title, summary, aliases, tags, content, hash FROM artifacts")?;
        let rows: Vec<ArtifactRow> = stmt
            .query_map([], map_artifact_row)?
            .collect::<Result<_, _>>()?;

        let mut artifacts = Vec::new();
        for row in rows {
            if let Some(filter_tags) = tags {
                let row_tags: Vec<String> = serde_json::from_str(&row.tags)?;
                if !filter_tags.iter().all(|t| row_tags.contains(t)) {
                    continue;
                }
            }
            artifacts.push(self.hydrate_artifact(row)?);
        }
        Ok(artifacts)
    }

    pub fn get_relationships(&self, slug: &str) -> StorageResult<Vec<Relationship>> {
        let mut stmt = self
            .conn
            .prepare("SELECT target, type, line, section FROM relationships WHERE source = ?")?;
        let rows = stmt.query_map(params![slug], |row| {
            Ok(Relationship {
                target: row.get(0)?,
                kind: row.get(1)?,
                line: row.get(2)?,
                section: row.get(3)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(StorageError::from)
    }

    pub fn get_inverse(&self, slug: &str) -> StorageResult<Vec<Relationship>> {
        let like_pattern = format!("{slug}#%");
        let mut stmt = self.conn.prepare(
            "SELECT source as target, type, line, section \
             FROM relationships WHERE target = ? OR target LIKE ?",
        )?;
        let rows = stmt.query_map(params![slug, like_pattern], |row| {
            Ok(Relationship {
                target: row.get(0)?,
                kind: row.get(1)?,
                line: row.get(2)?,
                section: row.get(3)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(StorageError::from)
    }

    pub fn fts_search(&self, query: &str) -> StorageResult<Vec<SearchResult>> {
        let processed = or_query(query, self.stop_word_filter.as_ref());
        if processed.is_empty() {
            return Ok(vec![]);
        }
        let mut stmt = self.conn.prepare(
            "SELECT f.slug, f.title, \
             snippet(artifacts_fts, -1, '<mark>', '</mark>', '...', 64) as snippet, \
             f.rank, a.summary \
             FROM artifacts_fts f \
             JOIN artifacts a ON a.slug = f.slug \
             WHERE artifacts_fts MATCH ? \
             ORDER BY f.rank",
        )?;
        let rows = stmt.query_map(params![processed], |row| {
            Ok(SearchResult {
                slug: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                rank: row.get(3)?,
                summary: row.get(4)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(StorageError::from)
    }

    pub fn vec_search(&self, query_vec: &[f32], limit: usize) -> StorageResult<Vec<RankedResult>> {
        if query_vec.len() != self.embedding_dim {
            return Err(StorageError::InvalidDimension {
                expected: self.embedding_dim,
                got: query_vec.len(),
            });
        }
        let mut stmt = self.conn.prepare(
            "SELECT slug, distance FROM artifacts_vec \
             WHERE embedding MATCH ? AND k = ? \
             ORDER BY distance",
        )?;
        let rows = stmt.query_map(params![query_vec.as_bytes(), limit as i64], |row| {
            Ok(RankedResult {
                slug: row.get(0)?,
                score: 1.0 - row.get::<_, f64>(1)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(StorageError::from)
    }

    pub fn hybrid_search(
        &self,
        query: &str,
        query_vec: Option<&[f32]>,
    ) -> StorageResult<Vec<SearchResult>> {
        let fts_results = self.fts_search(query)?;

        let query_vec = match query_vec {
            Some(v) => v,
            None => return Ok(fts_results),
        };

        let semantic_ranked = self.vec_search(query_vec, 20)?;

        let fts_ranked: Vec<RankedResult> = fts_results
            .iter()
            .map(|r| RankedResult {
                slug: r.slug.clone(),
                score: -r.rank,
            })
            .collect();

        let total_docs = self.count_artifacts()?;
        let fused = rrf::rrf(&[&fts_ranked, &semantic_ranked], 10, total_docs);

        let fts_map: HashMap<&str, &SearchResult> =
            fts_results.iter().map(|r| (r.slug.as_str(), r)).collect();

        let mut results = Vec::new();
        for (i, item) in fused.iter().enumerate() {
            if let Some(fts_hit) = fts_map.get(item.slug.as_str()) {
                results.push(SearchResult {
                    slug: fts_hit.slug.clone(),
                    title: fts_hit.title.clone(),
                    summary: fts_hit.summary.clone(),
                    snippet: fts_hit.snippet.clone(),
                    rank: (i + 1) as f64,
                });
            } else if let Some(a) = self.get(&item.slug)? {
                let snippet = a
                    .summary
                    .clone()
                    .unwrap_or_else(|| a.content.chars().take(200).collect());
                results.push(SearchResult {
                    slug: item.slug.clone(),
                    title: a.title,
                    summary: a.summary,
                    snippet,
                    rank: (i + 1) as f64,
                });
            }
        }

        Ok(results)
    }

    pub fn insert_embedding(&self, slug: &str, vector: &[f32]) -> StorageResult<()> {
        if vector.len() != self.embedding_dim {
            return Err(StorageError::InvalidDimension {
                expected: self.embedding_dim,
                got: vector.len(),
            });
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO artifacts_vec (slug, embedding) VALUES (?, ?)",
            params![slug, vector.as_bytes()],
        )?;
        Ok(())
    }

    pub fn count_artifacts(&self) -> StorageResult<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM artifacts", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn close(self) -> StorageResult<()> {
        self.conn.close().map_err(|(_, e)| StorageError::Sqlite(e))
    }

    fn hydrate_artifact(&self, row: ArtifactRow) -> StorageResult<Artifact> {
        let aliases: Option<Vec<String>> =
            row.aliases.map(|s| serde_json::from_str(&s)).transpose()?;
        let tags: Vec<String> = serde_json::from_str(&row.tags)?;
        let relationships = self.get_relationships(&row.slug)?;
        let sections = self.fetch_sections(&row.slug)?;

        Ok(Artifact {
            slug: row.slug,
            title: row.title,
            summary: row.summary,
            aliases,
            tags,
            content: row.content,
            hash: row.hash,
            relationships,
            sections,
        })
    }

    fn fetch_sections(&self, slug: &str) -> StorageResult<Vec<Section>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, heading, level, line FROM sections WHERE artifact_slug = ?")?;
        let rows = stmt.query_map(params![slug], |row| {
            Ok(Section {
                id: row.get(0)?,
                heading: row.get(1)?,
                level: row.get(2)?,
                line: row.get(3)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(StorageError::from)
    }
}

struct ArtifactRow {
    slug: String,
    title: String,
    summary: Option<String>,
    aliases: Option<String>,
    tags: String,
    content: String,
    hash: String,
}

fn map_artifact_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactRow> {
    Ok(ArtifactRow {
        slug: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        aliases: row.get(3)?,
        tags: row.get(4)?,
        content: row.get(5)?,
        hash: row.get(6)?,
    })
}

type SqliteExtInitFn = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::os::raw::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int;

fn register_sqlite_vec() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| {
        // SAFETY: sqlite3_vec_init has the sqlite3_extension_init calling convention.
        // The transmute is safe because sqlite3_vec_init matches SqliteExtInitFn.
        unsafe {
            let init: SqliteExtInitFn = std::mem::transmute::<*const (), SqliteExtInitFn>(
                sqlite_vec::sqlite3_vec_init as *const (),
            );
            rusqlite::ffi::sqlite3_auto_extension(Some(init));
        }
    });
}
