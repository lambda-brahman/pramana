use crate::error::EngineError;
use pramana_storage::{Relationship, SearchResult, Section, Storage};
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactView {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tags: Vec<String>,
    pub relationships: Vec<Relationship>,
    pub inverse_relationships: Vec<Relationship>,
    pub sections: Vec<Section>,
    pub content: String,
    pub hash: String,
    pub focused_section: Option<FocusedSection>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FocusedSection {
    pub id: String,
    pub heading: String,
    pub content: String,
}

#[derive(Debug, Clone, Default)]
pub struct ListFilter {
    pub tags: Option<Vec<String>>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

pub struct Reader<'a> {
    storage: &'a Storage,
}

impl<'a> Reader<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn get(&self, slug_with_section: &str) -> Result<Option<ArtifactView>, EngineError> {
        let (slug, section_id) = split_slug_section(slug_with_section);

        let artifact = match self.storage.get(slug)? {
            Some(a) => a,
            None => return Ok(None),
        };

        let inverse = self.storage.get_inverse(slug)?;

        let focused_section = section_id
            .and_then(|sid| extract_focused_section(&artifact.content, &artifact.sections, sid));

        Ok(Some(to_view(artifact, inverse, focused_section)))
    }

    pub fn search(
        &self,
        query: &str,
        query_vec: Option<&[f32]>,
    ) -> Result<Vec<SearchResult>, EngineError> {
        Ok(self.storage.hybrid_search(query, query_vec)?)
    }

    pub fn traverse(
        &self,
        from: &str,
        rel_type: Option<&str>,
        depth: usize,
        max_results: Option<usize>,
    ) -> Result<Vec<ArtifactView>, EngineError> {
        let mut visited = HashSet::new();
        let mut results = Vec::new();
        let mut current_level = vec![from.to_owned()];

        visited.insert(from.to_owned());

        for _ in 0..depth {
            if current_level.is_empty() {
                break;
            }

            if max_results.is_some_and(|cap| results.len() >= cap) {
                break;
            }

            let mut next_targets = Vec::new();
            for slug in &current_level {
                let rels = self.storage.get_relationships(slug)?;

                let filtered: Vec<_> = if let Some(rt) = rel_type {
                    rels.into_iter().filter(|r| r.kind == rt).collect()
                } else {
                    rels
                };

                for rel in filtered {
                    let target_slug = rel.target.split('#').next().unwrap_or(&rel.target);

                    if visited.contains(target_slug) {
                        continue;
                    }
                    visited.insert(target_slug.to_owned());
                    next_targets.push(target_slug.to_owned());
                }
            }

            if next_targets.is_empty() {
                break;
            }

            let slug_refs: Vec<&str> = next_targets.iter().map(|s| s.as_str()).collect();
            let mut artifacts_map = self.storage.get_batch(&slug_refs)?;
            let mut inverse_map = self.storage.get_inverse_batch(&slug_refs)?;

            let remaining = max_results.map(|cap| cap.saturating_sub(results.len()));

            let mut next_level = Vec::new();
            for slug in &next_targets {
                if remaining.is_some_and(|r| next_level.len() >= r) {
                    break;
                }

                if let Some(artifact) = artifacts_map.remove(slug.as_str()) {
                    let inverse = inverse_map.remove(slug.as_str()).unwrap_or_default();
                    results.push(to_view(artifact, inverse, None));
                    next_level.push(slug.clone());
                }
            }

            current_level = next_level;
        }

        Ok(results)
    }

    pub fn list(&self, filter: Option<&ListFilter>) -> Result<Vec<ArtifactView>, EngineError> {
        let tags = filter.and_then(|f| f.tags.as_deref());
        let artifacts = self.storage.list(tags)?;

        let offset = filter.and_then(|f| f.offset).unwrap_or(0);
        let limit = filter.and_then(|f| f.limit);

        let page: Vec<_> = match limit {
            Some(n) => artifacts.into_iter().skip(offset).take(n).collect(),
            None => artifacts.into_iter().skip(offset).collect(),
        };

        let slugs: Vec<&str> = page.iter().map(|a| a.slug.as_str()).collect();
        let mut inverse_map = self.storage.get_inverse_batch(&slugs)?;

        let mut views = Vec::with_capacity(page.len());
        for artifact in page {
            let inverse = inverse_map.remove(&artifact.slug).unwrap_or_default();
            views.push(to_view(artifact, inverse, None));
        }

        Ok(views)
    }
}

fn to_view(
    artifact: pramana_storage::Artifact,
    inverse: Vec<Relationship>,
    focused_section: Option<FocusedSection>,
) -> ArtifactView {
    ArtifactView {
        slug: artifact.slug,
        title: artifact.title,
        summary: artifact.summary,
        aliases: artifact.aliases,
        tags: artifact.tags,
        relationships: artifact.relationships,
        inverse_relationships: inverse,
        sections: artifact.sections,
        content: artifact.content,
        hash: artifact.hash,
        focused_section,
    }
}

fn split_slug_section(input: &str) -> (&str, Option<&str>) {
    match input.find('#') {
        Some(pos) => (&input[..pos], Some(&input[pos + 1..])),
        None => (input, None),
    }
}

fn extract_focused_section(
    content: &str,
    sections: &[Section],
    section_id: &str,
) -> Option<FocusedSection> {
    let section = sections.iter().find(|s| s.id == section_id)?;
    // Parser emits 1-based line numbers; convert to 0-based for indexing
    let lines: Vec<&str> = content.split('\n').collect();
    let start = (section.line as usize).saturating_sub(1);

    if start >= lines.len() {
        return None;
    }

    let end = sections
        .iter()
        .filter(|s| s.line > section.line && s.level <= section.level)
        .map(|s| (s.line as usize).saturating_sub(1))
        .min()
        .unwrap_or(lines.len());

    let section_content = lines[start..end].join("\n");

    Some(FocusedSection {
        id: section.id.clone(),
        heading: section.heading.clone(),
        content: section_content.trim().to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_slug_section_without_section() {
        let (slug, section) = split_slug_section("order");
        assert_eq!(slug, "order");
        assert_eq!(section, None);
    }

    #[test]
    fn split_slug_section_with_section() {
        let (slug, section) = split_slug_section("order#attributes");
        assert_eq!(slug, "order");
        assert_eq!(section, Some("attributes"));
    }

    #[test]
    fn extract_section_from_content() {
        let content = "# Title\n\n## First\nContent A\n\n## Second\nContent B\n";
        // Line numbers are 1-based, matching parser output (sections.rs uses i + 1)
        let sections = vec![
            Section {
                id: "first".into(),
                heading: "First".into(),
                level: 2,
                line: 3,
            },
            Section {
                id: "second".into(),
                heading: "Second".into(),
                level: 2,
                line: 6,
            },
        ];

        let focused = extract_focused_section(content, &sections, "first").unwrap();
        assert_eq!(focused.id, "first");
        assert!(focused.content.contains("## First"));
        assert!(focused.content.contains("Content A"));
        assert!(!focused.content.contains("Content B"));
        assert!(!focused.content.contains("## Second"));
    }
}
