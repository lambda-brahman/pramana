use crate::error::EngineError;
use pramana_storage::{Relationship, SearchResult, Section, Storage};
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub struct FocusedSection {
    pub id: String,
    pub heading: String,
    pub content: String,
}

#[derive(Debug, Clone, Default)]
pub struct ListFilter {
    pub tags: Option<Vec<String>>,
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
    ) -> Result<Vec<ArtifactView>, EngineError> {
        let mut visited = HashSet::new();
        let mut results = Vec::new();
        let mut queue = VecDeque::new();

        visited.insert(from.to_owned());
        queue.push_back((from.to_owned(), 0usize));

        while let Some((slug, current_depth)) = queue.pop_front() {
            if current_depth >= depth {
                continue;
            }

            let rels = self.storage.get_relationships(&slug)?;

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

                if let Some(artifact) = self.storage.get(target_slug)? {
                    let inverse = self.storage.get_inverse(target_slug)?;
                    results.push(to_view(artifact, inverse, None));
                    queue.push_back((target_slug.to_owned(), current_depth + 1));
                }
            }
        }

        Ok(results)
    }

    pub fn list(&self, filter: Option<&ListFilter>) -> Result<Vec<ArtifactView>, EngineError> {
        let tags = filter.and_then(|f| f.tags.as_deref());
        let artifacts = self.storage.list(tags)?;

        let mut views = Vec::with_capacity(artifacts.len());
        for artifact in artifacts {
            let inverse = self.storage.get_inverse(&artifact.slug)?;
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
