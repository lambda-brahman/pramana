pub const DDL: &str = "\
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
    FOREIGN KEY (source) REFERENCES artifacts(slug) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sections (
    artifact_slug TEXT NOT NULL,
    id TEXT NOT NULL,
    heading TEXT NOT NULL,
    level INTEGER NOT NULL,
    line INTEGER NOT NULL,
    FOREIGN KEY (artifact_slug) REFERENCES artifacts(slug) ON DELETE CASCADE
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
";

pub fn vec0_ddl(dim: usize) -> String {
    format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_vec USING vec0(\
         slug TEXT PRIMARY KEY, \
         embedding float[{dim}] distance_metric=cosine\
         );"
    )
}
