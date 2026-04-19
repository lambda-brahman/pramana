#[cfg(not(target_endian = "little"))]
compile_error!(
    "pramana-storage requires a little-endian target; \
     sqlite-vec encodes f32 embeddings as little-endian bytes"
);

use crate::error::{StorageError, StorageResult};
use crate::fts::{or_query, NoOpFilter, StopWordFilter};
use crate::model::{Artifact, RankedResult, Relationship, SearchResult, Section};
use crate::{rrf, schema};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::sync::Once;
use zerocopy::AsBytes;

const DEFAULT_VEC_LIMIT: usize = 20;
const DEFAULT_RRF_K: usize = 10;
const BATCH_CHUNK: usize = 900;
const BUSY_TIMEOUT_MS: u32 = 5_000;
const SCHEMA_VERSION: i32 = 1;

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
        self.conn
            .execute_batch(&format!("PRAGMA busy_timeout = {BUSY_TIMEOUT_MS};"))?;

        // WAL mode improves concurrent read throughput; verify it was accepted.
        // In-memory databases stay in "memory" mode — that is expected and fine.
        let mode: String = self
            .conn
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
        if mode != "wal" && mode != "memory" {
            return Err(StorageError::WalModeUnavailable);
        }

        self.conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        let current_version: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;

        if current_version < SCHEMA_VERSION {
            self.conn.execute_batch(schema::DDL)?;
            self.conn
                .execute_batch(&schema::vec0_ddl(self.embedding_dim))?;
            self.conn
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        }

        Ok(())
    }

    // SAFETY: unchecked_transaction() is used instead of transaction() so that
    // insert_artifact can take &self (matching the read-method signatures). This
    // is sound only because no rusqlite::Statement is alive when the transaction
    // begins — all query methods eagerly .collect() into Vec before returning.
    // If lazy iteration or a statement cache is added, switch to &mut self.
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
        match self.conn.query_row(
            "SELECT slug, title, summary, aliases, tags, content, hash \
             FROM artifacts WHERE slug = ?",
            params![slug],
            map_artifact_row,
        ) {
            Ok(row) => self.hydrate_artifact(row).map(Some),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(StorageError::Sqlite(e)),
        }
    }

    pub fn list(
        &self,
        tags: Option<&[String]>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> StorageResult<Vec<Artifact>> {
        // SQLite treats LIMIT -1 as no limit.
        let limit_val: i64 = limit.map(|n| n as i64).unwrap_or(-1);
        let offset_val: i64 = offset.unwrap_or(0) as i64;

        let rows: Vec<ArtifactRow> = match tags {
            Some(filter_tags) if !filter_tags.is_empty() => {
                let mut unique: Vec<&str> = filter_tags.iter().map(|s| s.as_str()).collect();
                unique.sort_unstable();
                unique.dedup();
                let tags_json = serde_json::to_string(&unique)?;
                let tag_count = unique.len() as i64;
                let mut stmt = self.conn.prepare(
                    "SELECT slug, title, summary, aliases, tags, content, hash \
                     FROM artifacts \
                     WHERE (SELECT COUNT(DISTINCT jt.value) FROM json_each(tags) jt \
                            WHERE jt.value IN (SELECT value FROM json_each(?1))) = ?2 \
                     ORDER BY slug \
                     LIMIT ?3 OFFSET ?4",
                )?;
                let rows: Vec<ArtifactRow> = stmt
                    .query_map(
                        params![tags_json, tag_count, limit_val, offset_val],
                        map_artifact_row,
                    )?
                    .collect::<Result<_, _>>()?;
                rows
            }
            _ => {
                let mut stmt = self.conn.prepare(
                    "SELECT slug, title, summary, aliases, tags, content, hash FROM artifacts \
                     ORDER BY slug \
                     LIMIT ?1 OFFSET ?2",
                )?;
                let rows: Vec<ArtifactRow> = stmt
                    .query_map(params![limit_val, offset_val], map_artifact_row)?
                    .collect::<Result<_, _>>()?;
                rows
            }
        };

        self.hydrate_artifacts(rows)
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
        let escaped = slug
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_pattern = format!("{escaped}#%");
        let mut stmt = self.conn.prepare(
            "SELECT source as target, type, line, section \
             FROM relationships WHERE target = ? OR target LIKE ? ESCAPE '\\'",
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
        if query_vec.iter().any(|v| !v.is_finite()) {
            return Err(StorageError::NonFiniteEmbedding);
        }
        let mut stmt = self.conn.prepare(
            "SELECT slug, distance FROM artifacts_vec \
             WHERE embedding MATCH ? AND k = ? \
             ORDER BY distance",
        )?;
        let rows = stmt.query_map(params![query_vec.as_bytes(), limit as i64], |row| {
            // Cosine distance ∈ [0, 2]; clamp to keep similarity score in [0, 1].
            let distance: f64 = row.get(1)?;
            Ok(RankedResult {
                slug: row.get(0)?,
                score: (1.0_f64 - distance).clamp(0.0, 1.0),
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

        let semantic_ranked = self.vec_search(query_vec, DEFAULT_VEC_LIMIT)?;

        let fts_ranked: Vec<RankedResult> = fts_results
            .iter()
            .map(|r| RankedResult {
                slug: r.slug.clone(),
                score: -r.rank,
            })
            .collect();

        let total_docs = self.count_artifacts()?;
        let fused = rrf::rrf(&[&fts_ranked, &semantic_ranked], DEFAULT_RRF_K, total_docs);

        let fts_map: HashMap<&str, &SearchResult> =
            fts_results.iter().map(|r| (r.slug.as_str(), r)).collect();

        // Batch-fetch artifacts that appear in vec results but not FTS results,
        // avoiding one self.get() call per vec-only result.
        let vec_only_slugs: Vec<&str> = fused
            .iter()
            .filter(|item| !fts_map.contains_key(item.slug.as_str()))
            .map(|item| item.slug.as_str())
            .collect();
        let vec_only_map = if vec_only_slugs.is_empty() {
            HashMap::new()
        } else {
            self.get_batch(&vec_only_slugs)?
        };

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
            } else if let Some(a) = vec_only_map.get(&item.slug) {
                let snippet = a
                    .summary
                    .clone()
                    .unwrap_or_else(|| a.content.chars().take(200).collect());
                results.push(SearchResult {
                    slug: item.slug.clone(),
                    title: a.title.clone(),
                    summary: a.summary.clone(),
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
        if vector.iter().any(|v| !v.is_finite()) {
            return Err(StorageError::NonFiniteEmbedding);
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO artifacts_vec (slug, embedding) VALUES (?, ?)",
            params![slug, vector.as_bytes()],
        )?;
        Ok(())
    }

    pub fn schema_version(&self) -> StorageResult<i32> {
        let v: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        Ok(v)
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

    pub fn get_batch(&self, slugs: &[&str]) -> StorageResult<HashMap<String, Artifact>> {
        if slugs.is_empty() {
            return Ok(HashMap::new());
        }

        let mut all_rows: Vec<ArtifactRow> = Vec::new();
        for chunk in slugs.chunks(BATCH_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT slug, title, summary, aliases, tags, content, hash \
                 FROM artifacts WHERE slug IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let sql_params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            let rows: Vec<ArtifactRow> = stmt
                .query_map(sql_params.as_slice(), map_artifact_row)?
                .collect::<Result<_, _>>()?;
            all_rows.extend(rows);
        }

        let artifacts = self.hydrate_artifacts(all_rows)?;
        Ok(artifacts.into_iter().map(|a| (a.slug.clone(), a)).collect())
    }

    pub fn get_inverse_batch(
        &self,
        slugs: &[&str],
    ) -> StorageResult<HashMap<String, Vec<Relationship>>> {
        if slugs.is_empty() {
            return Ok(HashMap::new());
        }

        let mut result: HashMap<String, Vec<Relationship>> = HashMap::new();

        for chunk in slugs.chunks(BATCH_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql_params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();

            // Exact target matches — uses idx_relationships_target
            {
                let sql = format!(
                    "SELECT source, target, type, line, section \
                     FROM relationships WHERE target IN ({placeholders})"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let rows = stmt.query_map(sql_params.as_slice(), map_inverse_row)?;
                for row in rows {
                    let r = row?;
                    result.entry(r.target).or_default().push(Relationship {
                        target: r.source,
                        kind: r.kind,
                        line: r.line,
                        section: r.section,
                    });
                }
            }

            // Section-level targets (e.g., target = 'slug#section')
            {
                let sql = format!(
                    "SELECT source, target, type, line, section \
                     FROM relationships \
                     WHERE instr(target, '#') > 0 \
                       AND substr(target, 1, instr(target, '#') - 1) IN ({placeholders})"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let rows = stmt.query_map(sql_params.as_slice(), map_inverse_row)?;
                for row in rows {
                    let r = row?;
                    let base_slug = match r.target.find('#') {
                        Some(pos) => &r.target[..pos],
                        None => &r.target,
                    };
                    result
                        .entry(base_slug.to_owned())
                        .or_default()
                        .push(Relationship {
                            target: r.source,
                            kind: r.kind,
                            line: r.line,
                            section: r.section,
                        });
                }
            }
        }

        Ok(result)
    }

    fn hydrate_artifacts(&self, rows: Vec<ArtifactRow>) -> StorageResult<Vec<Artifact>> {
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let slugs: Vec<&str> = rows.iter().map(|r| r.slug.as_str()).collect();
        let mut rels_map = self.get_relationships_batch(&slugs)?;
        let mut secs_map = self.fetch_sections_batch(&slugs)?;

        let mut artifacts = Vec::with_capacity(rows.len());
        for row in rows {
            let aliases: Option<Vec<String>> =
                row.aliases.map(|s| serde_json::from_str(&s)).transpose()?;
            let tags: Vec<String> = serde_json::from_str(&row.tags)?;
            let relationships = rels_map.remove(&row.slug).unwrap_or_default();
            let sections = secs_map.remove(&row.slug).unwrap_or_default();

            artifacts.push(Artifact {
                slug: row.slug,
                title: row.title,
                summary: row.summary,
                aliases,
                tags,
                content: row.content,
                hash: row.hash,
                relationships,
                sections,
            });
        }

        Ok(artifacts)
    }

    fn get_relationships_batch(
        &self,
        slugs: &[&str],
    ) -> StorageResult<HashMap<String, Vec<Relationship>>> {
        if slugs.is_empty() {
            return Ok(HashMap::new());
        }

        let mut result: HashMap<String, Vec<Relationship>> = HashMap::new();
        for chunk in slugs.chunks(BATCH_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT source, target, type, line, section \
                 FROM relationships WHERE source IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let sql_params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();

            let rows = stmt.query_map(sql_params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Relationship {
                        target: row.get(1)?,
                        kind: row.get(2)?,
                        line: row.get(3)?,
                        section: row.get(4)?,
                    },
                ))
            })?;

            for row in rows {
                let (source, rel) = row?;
                result.entry(source).or_default().push(rel);
            }
        }

        Ok(result)
    }

    fn fetch_sections_batch(&self, slugs: &[&str]) -> StorageResult<HashMap<String, Vec<Section>>> {
        if slugs.is_empty() {
            return Ok(HashMap::new());
        }

        let mut result: HashMap<String, Vec<Section>> = HashMap::new();
        for chunk in slugs.chunks(BATCH_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT artifact_slug, id, heading, level, line \
                 FROM sections WHERE artifact_slug IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let sql_params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();

            let rows = stmt.query_map(sql_params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Section {
                        id: row.get(1)?,
                        heading: row.get(2)?,
                        level: row.get(3)?,
                        line: row.get(4)?,
                    },
                ))
            })?;

            for row in rows {
                let (slug, section) = row?;
                result.entry(slug).or_default().push(section);
            }
        }

        Ok(result)
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

struct InverseRow {
    source: String,
    target: String,
    kind: String,
    line: Option<i64>,
    section: Option<String>,
}

fn map_inverse_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<InverseRow> {
    Ok(InverseRow {
        source: row.get(0)?,
        target: row.get(1)?,
        kind: row.get(2)?,
        line: row.get(3)?,
        section: row.get(4)?,
    })
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
