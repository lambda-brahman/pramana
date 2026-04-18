use std::sync::LazyLock;

use regex::Regex;
use serde_yaml::Value;

use crate::error::ParseError;
use crate::types::{FrontmatterData, Relationship, RelationshipType};

static FRONTMATTER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n(.*)$").unwrap());

pub fn parse_frontmatter(raw: &str) -> Result<FrontmatterData, ParseError> {
    let caps = FRONTMATTER_RE
        .captures(raw)
        .ok_or_else(|| ParseError::Frontmatter {
            message: "No frontmatter found".into(),
        })?;

    let yaml_block = &caps[1];
    let body = caps[2].to_string();

    let value: Value = serde_yaml::from_str(yaml_block).map_err(|e| ParseError::Frontmatter {
        message: format!("Invalid YAML: {e}"),
    })?;

    let mapping = value.as_mapping().ok_or_else(|| ParseError::Frontmatter {
        message: "Frontmatter is not a valid object".into(),
    })?;

    let slug = mapping
        .get("slug")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ParseError::Frontmatter {
            message: "Missing required field: slug".into(),
        })?
        .to_string();

    let tags = mapping
        .get("tags")
        .and_then(Value::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let relationships = mapping
        .get("relationships")
        .map(normalize_relationships)
        .unwrap_or_default();

    let title = mapping
        .get("title")
        .and_then(Value::as_str)
        .map(String::from);

    let summary = mapping
        .get("summary")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from);

    let aliases: Option<Vec<String>> = mapping
        .get("aliases")
        .and_then(Value::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .filter(|a: &Vec<String>| !a.is_empty());

    Ok(FrontmatterData {
        slug,
        title,
        summary,
        aliases,
        tags,
        relationships,
        body,
    })
}

fn normalize_relationships(value: &Value) -> Vec<Relationship> {
    let mapping = match value.as_mapping() {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, val) in mapping {
        let type_str = match key.as_str() {
            Some(s) => s,
            None => continue,
        };

        let rel_type = match type_str.parse::<RelationshipType>() {
            Ok(t) => t,
            Err(()) => continue,
        };

        let targets: Vec<String> = match val {
            Value::String(s) => vec![s.clone()],
            Value::Sequence(seq) => seq
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
            _ => continue,
        };

        for target in targets {
            result.push(Relationship {
                target,
                rel_type: rel_type.clone(),
                line: None,
                section: None,
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_slug_tags_and_relationships() {
        let raw = "---\nslug: order\ntags: [entity, commerce, core]\nrelationships:\n  depends-on: [customer, line-item, shipping-info]\n---\n\n# Order\n\nContent here.";

        let result = parse_frontmatter(raw);
        assert!(result.is_ok());
        let data = result.unwrap();

        assert_eq!(data.slug, "order");
        assert_eq!(data.tags, vec!["entity", "commerce", "core"]);
        assert_eq!(data.relationships.len(), 3);
        assert!(data
            .relationships
            .iter()
            .any(|r| r.target == "customer" && r.rel_type == RelationshipType::DependsOn));
        assert!(data
            .relationships
            .iter()
            .any(|r| r.target == "line-item" && r.rel_type == RelationshipType::DependsOn));
        assert!(data
            .relationships
            .iter()
            .any(|r| r.target == "shipping-info" && r.rel_type == RelationshipType::DependsOn));
    }

    #[test]
    fn returns_error_when_no_frontmatter() {
        let result = parse_frontmatter("# Just a heading\n\nNo frontmatter.");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ParseError::Frontmatter { .. }));
    }

    #[test]
    fn returns_error_when_slug_is_missing() {
        let raw = "---\ntags: [test]\n---\n\nContent.";
        let result = parse_frontmatter(raw);
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            ParseError::Frontmatter { message } => assert!(message.contains("slug")),
            _ => panic!("expected frontmatter error"),
        }
    }

    #[test]
    fn handles_empty_tags() {
        let raw = "---\nslug: minimal\n---\n\n# Minimal";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(result.tags, Vec::<String>::new());
        assert_eq!(result.relationships, Vec::<Relationship>::new());
    }

    #[test]
    fn extracts_title_from_frontmatter() {
        let raw = "---\nslug: test\ntitle: Custom Title\n---\n\n# Different Title";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(result.title, Some("Custom Title".into()));
    }

    #[test]
    fn preserves_body_content() {
        let raw = "---\nslug: test\n---\n\n# Title\n\nBody content here.";
        let result = parse_frontmatter(raw).unwrap();
        assert!(result.body.contains("Body content here."));
    }

    #[test]
    fn extracts_summary_from_frontmatter() {
        let raw =
            "---\nslug: order\nsummary: \"A customer's intent to purchase one or more products\"\n---\n\n# Order";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(
            result.summary,
            Some("A customer's intent to purchase one or more products".into())
        );
    }

    #[test]
    fn extracts_aliases_from_frontmatter() {
        let raw =
            "---\nslug: order\naliases: [purchase-order, sales-order, transaction]\n---\n\n# Order";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(
            result.aliases,
            Some(vec![
                "purchase-order".into(),
                "sales-order".into(),
                "transaction".into()
            ])
        );
    }

    #[test]
    fn summary_and_aliases_are_none_when_absent() {
        let raw = "---\nslug: minimal\n---\n\n# Minimal";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(result.summary, None);
        assert_eq!(result.aliases, None);
    }

    #[test]
    fn strips_quotes_from_summary_value() {
        let raw = "---\nslug: test\nsummary: 'Single quoted summary'\n---\n\nBody.";
        let result = parse_frontmatter(raw).unwrap();
        assert_eq!(result.summary, Some("Single quoted summary".into()));
    }
}
