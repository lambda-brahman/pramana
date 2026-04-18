#[derive(Debug, Clone)]
pub struct Artifact {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tags: Vec<String>,
    pub content: String,
    pub hash: String,
    pub relationships: Vec<Relationship>,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone)]
pub struct Relationship {
    pub target: String,
    pub kind: String,
    pub line: Option<i64>,
    pub section: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Section {
    pub id: String,
    pub heading: String,
    pub level: i64,
    pub line: i64,
}

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Clone)]
pub struct RankedResult {
    pub slug: String,
    pub score: f64,
}
