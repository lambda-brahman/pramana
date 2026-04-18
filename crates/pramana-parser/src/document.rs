use std::sync::LazyLock;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::error::ParseError;
use crate::frontmatter::parse_frontmatter;
use crate::sections::parse_sections;
use crate::types::KnowledgeArtifact;
use crate::wikilinks::parse_wikilinks;

static TITLE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^#\s+(.+)$").unwrap());

pub fn parse_document(raw: &str) -> Result<KnowledgeArtifact, ParseError> {
    let fm = parse_frontmatter(raw)?;

    let title_match = TITLE_RE.captures(&fm.body);
    let title = fm
        .title
        .or_else(|| title_match.map(|c| c[1].trim().to_string()))
        .unwrap_or_else(|| fm.slug.clone());

    let sections = parse_sections(&fm.body);
    let content_relationships = parse_wikilinks(&fm.body, &sections);

    let mut relationships = fm.relationships;
    relationships.extend(content_relationships);

    let hash = sha256_hex(raw);

    Ok(KnowledgeArtifact {
        slug: fm.slug,
        title,
        summary: fm.summary,
        aliases: fm.aliases,
        tags: fm.tags,
        relationships,
        sections,
        content: fm.body,
        hash,
    })
}

pub fn parse_document_from_file(
    file_path: &std::path::Path,
) -> Result<KnowledgeArtifact, ParseError> {
    let raw = std::fs::read_to_string(file_path).map_err(|e| ParseError::Read {
        message: format!("Failed to read {}: {e}", file_path.display()),
    })?;
    let normalized = raw.replace("\r\n", "\n");
    parse_document(&normalized)
}

fn sha256_hex(data: &str) -> String {
    let result = Sha256::digest(data.as_bytes());
    result.iter().fold(String::with_capacity(64), |mut acc, b| {
        use std::fmt::Write;
        let _ = write!(acc, "{:02x}", b);
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RelationshipType;

    #[test]
    fn parses_a_complete_document() {
        let raw = "---\nslug: order\ntags: [entity, commerce]\nrelationships:\n  depends-on: customer\n---\n\n# Order\n\nAn Order represents a purchase.\n\n## Attributes\n- lineItems: [[line-item]][]\n\n## Rules\n- Total from [[depends-on::line-item#pricing]]";

        let result = parse_document(raw);
        assert!(result.is_ok());
        let artifact = result.unwrap();

        assert_eq!(artifact.slug, "order");
        assert_eq!(artifact.title, "Order");
        assert_eq!(artifact.tags, vec!["entity", "commerce"]);
        assert_eq!(artifact.sections.len(), 2);
        assert_eq!(artifact.hash.len(), 64);

        assert!(artifact.relationships.len() >= 3);
        assert!(artifact
            .relationships
            .iter()
            .any(|r| r.target == "customer" && r.rel_type == RelationshipType::DependsOn));
        assert!(artifact
            .relationships
            .iter()
            .any(|r| r.target == "line-item" && r.rel_type == RelationshipType::RelatesTo));
        assert!(artifact
            .relationships
            .iter()
            .any(|r| r.target == "line-item#pricing" && r.rel_type == RelationshipType::DependsOn));
    }

    #[test]
    fn uses_slug_as_title_when_no_h1() {
        let raw = "---\nslug: no-title\n---\n\nJust content, no heading.";
        let result = parse_document(raw).unwrap();
        assert_eq!(result.title, "no-title");
    }

    #[test]
    fn uses_frontmatter_title_over_h1() {
        let raw = "---\nslug: test\ntitle: FM Title\n---\n\n# H1 Title";
        let result = parse_document(raw).unwrap();
        assert_eq!(result.title, "FM Title");
    }

    #[test]
    fn includes_summary_and_aliases_in_artifact() {
        let raw = "---\nslug: order\nsummary: \"A customer's intent to purchase\"\naliases: [purchase-order, PO]\ntags: [entity]\n---\n\n# Order\n\nContent.";
        let result = parse_document(raw).unwrap();
        assert_eq!(
            result.summary,
            Some("A customer's intent to purchase".into())
        );
        assert_eq!(
            result.aliases,
            Some(vec!["purchase-order".into(), "PO".into()])
        );
    }

    #[test]
    fn omits_summary_and_aliases_when_absent() {
        let raw = "---\nslug: minimal\n---\n\n# Minimal";
        let result = parse_document(raw).unwrap();
        assert_eq!(result.summary, None);
        assert_eq!(result.aliases, None);
    }

    #[test]
    fn produces_deterministic_hash() {
        let raw = "---\nslug: hash-test\n---\n\n# Hash Test";
        let r1 = parse_document(raw).unwrap();
        let r2 = parse_document(raw).unwrap();
        assert_eq!(r1.hash, r2.hash);
    }
}
