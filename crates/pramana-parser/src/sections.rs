use std::sync::LazyLock;

use regex::Regex;

use crate::types::Section;

static HEADING_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(#{2,3})\s+(.+)$").unwrap());

static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9\s\-]").unwrap());
static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static MULTI_HYPHEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-+").unwrap());

pub fn parse_sections(body: &str) -> Vec<Section> {
    let mut sections = Vec::new();

    for (i, line) in body.split('\n').enumerate() {
        if let Some(caps) = HEADING_RE.captures(line) {
            let hashes = &caps[1];
            let heading = caps[2].trim().to_string();

            sections.push(Section {
                id: to_kebab_case(&heading),
                heading,
                level: hashes.len(),
                line: i + 1,
            });
        }
    }

    sections
}

fn to_kebab_case(text: &str) -> String {
    let lower = text.to_lowercase();
    let cleaned = NON_ALNUM.replace_all(&lower, "");
    let with_hyphens = WHITESPACE.replace_all(&cleaned, "-");
    let collapsed = MULTI_HYPHEN.replace_all(&with_hyphens, "-");
    collapsed.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_h2_and_h3_headings() {
        let body = "# Title\n\n## Attributes\nSome content.\n\n## Rules\nMore content.\n\n### Sub Rule\nDetails.";

        let sections = parse_sections(body);
        assert_eq!(sections.len(), 3);

        assert_eq!(
            sections[0],
            Section {
                id: "attributes".into(),
                heading: "Attributes".into(),
                level: 2,
                line: 3,
            }
        );

        assert_eq!(
            sections[1],
            Section {
                id: "rules".into(),
                heading: "Rules".into(),
                level: 2,
                line: 6,
            }
        );

        assert_eq!(
            sections[2],
            Section {
                id: "sub-rule".into(),
                heading: "Sub Rule".into(),
                level: 3,
                line: 9,
            }
        );
    }

    #[test]
    fn ignores_h1_headings() {
        let sections = parse_sections("# Title Only");
        assert_eq!(sections.len(), 0);
    }

    #[test]
    fn generates_kebab_case_ids() {
        let sections = parse_sections("## My Complex Heading Name");
        assert_eq!(sections[0].id, "my-complex-heading-name");
    }

    #[test]
    fn handles_empty_body() {
        let sections = parse_sections("");
        assert_eq!(sections.len(), 0);
    }

    #[test]
    fn strips_special_characters_from_ids() {
        let sections = parse_sections("## Pricing & Discounts (v2)");
        assert_eq!(sections[0].id, "pricing-discounts-v2");
    }
}
