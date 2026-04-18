use std::sync::LazyLock;

use regex::Regex;

use crate::types::{Relationship, RelationshipType, Section};

static WIKILINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[(?:([^:\]]+)::)?([^\]]+)\]\]").unwrap());

pub fn parse_wikilinks(body: &str, sections: &[Section]) -> Vec<Relationship> {
    let mut relationships = Vec::new();

    for (i, line) in body.split('\n').enumerate() {
        for caps in WIKILINK_RE.captures_iter(line) {
            let raw_type = caps
                .get(1)
                .map(|m| m.as_str().trim())
                .unwrap_or("relates-to");

            let rel_type = raw_type
                .parse::<RelationshipType>()
                .unwrap_or(RelationshipType::RelatesTo);

            let target = caps
                .get(2)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();

            let line_num = i + 1;
            let section = find_containing_section(line_num, sections);

            relationships.push(Relationship {
                target,
                rel_type,
                line: Some(line_num),
                section,
            });
        }
    }

    relationships
}

fn find_containing_section(line: usize, sections: &[Section]) -> Option<String> {
    let mut current: Option<&Section> = None;
    for section in sections {
        if section.line <= line {
            current = Some(section);
        } else {
            break;
        }
    }
    current.map(|s| s.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_sections() -> Vec<Section> {
        vec![
            Section {
                id: "attributes".into(),
                heading: "Attributes".into(),
                level: 2,
                line: 3,
            },
            Section {
                id: "rules".into(),
                heading: "Rules".into(),
                level: 2,
                line: 7,
            },
        ]
    }

    #[test]
    fn parses_simple_wikilinks() {
        let body = "# Order\n\n## Attributes\n- lineItems: [[line-item]][] required";
        let sections = test_sections();

        let rels = parse_wikilinks(body, &sections);
        assert_eq!(rels.len(), 1);
        assert_eq!(
            rels[0],
            Relationship {
                target: "line-item".into(),
                rel_type: RelationshipType::RelatesTo,
                line: Some(4),
                section: Some("attributes".into()),
            }
        );
    }

    #[test]
    fn parses_typed_wikilinks() {
        let body =
            "# Order\n\n## Attributes\nSome content.\n\n## Rules\n- Total from [[depends-on::line-item#pricing]] values";
        let sections = test_sections();

        let rels = parse_wikilinks(body, &sections);
        assert_eq!(rels.len(), 1);
        assert_eq!(
            rels[0],
            Relationship {
                target: "line-item#pricing".into(),
                rel_type: RelationshipType::DependsOn,
                line: Some(7),
                section: Some("rules".into()),
            }
        );
    }

    #[test]
    fn parses_multiple_wikilinks_on_same_line() {
        let body = "Link to [[order]] and [[customer]] here.";
        let rels = parse_wikilinks(body, &[]);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].target, "order");
        assert_eq!(rels[1].target, "customer");
    }

    #[test]
    fn handles_empty_body() {
        let rels = parse_wikilinks("", &[]);
        assert_eq!(rels.len(), 0);
    }

    #[test]
    fn assigns_correct_section_context() {
        let body =
            "# Title\n\n## Attributes\nLink to [[target-a]]\n\n## Rules\nLink to [[target-b]]";
        let sections = test_sections();

        let rels = parse_wikilinks(body, &sections);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].section, Some("attributes".into()));
        assert_eq!(rels[1].section, Some("rules".into()));
    }
}
