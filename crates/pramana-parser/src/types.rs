use std::fmt;
use std::str::FromStr;

pub const RELATIONSHIP_TYPES: &[&str] = &["depends-on", "relates-to"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelationshipType {
    DependsOn,
    RelatesTo,
}

impl RelationshipType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DependsOn => "depends-on",
            Self::RelatesTo => "relates-to",
        }
    }
}

impl FromStr for RelationshipType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "depends-on" => Ok(Self::DependsOn),
            "relates-to" => Ok(Self::RelatesTo),
            _ => Err(()),
        }
    }
}

impl fmt::Display for RelationshipType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    pub target: String,
    pub rel_type: RelationshipType,
    pub line: Option<usize>,
    pub section: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub id: String,
    pub heading: String,
    pub level: usize,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontmatterData {
    pub slug: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tags: Vec<String>,
    pub relationships: Vec<Relationship>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeArtifact {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tags: Vec<String>,
    pub relationships: Vec<Relationship>,
    pub sections: Vec<Section>,
    pub content: String,
    pub hash: String,
}
