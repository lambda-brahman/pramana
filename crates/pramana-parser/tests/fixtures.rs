use std::path::PathBuf;

use pramana_parser::{parse_document_from_file, RelationshipType};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/fixtures")
        .canonicalize()
        .expect("test/fixtures directory must exist")
}

#[test]
fn parses_order_fixture() {
    let path = fixtures_dir().join("order.md");
    let artifact = parse_document_from_file(&path).expect("order.md should parse");

    assert_eq!(artifact.slug, "order");
    assert_eq!(artifact.title, "Order");
    assert_eq!(
        artifact.summary,
        Some("A customer's intent to purchase one or more products".into())
    );
    assert_eq!(
        artifact.aliases,
        Some(vec![
            "purchase-order".into(),
            "sales-order".into(),
            "transaction".into()
        ])
    );
    assert_eq!(artifact.tags, vec!["entity", "commerce", "core"]);
    assert_eq!(artifact.hash.len(), 64);

    assert_eq!(artifact.sections.len(), 2);
    assert_eq!(artifact.sections[0].id, "attributes");
    assert_eq!(artifact.sections[1].id, "rules");

    // 3 frontmatter depends-on + 4 content wikilinks
    assert!(artifact.relationships.len() >= 7);

    // Frontmatter relationships
    assert!(artifact.relationships.iter().any(|r| r.target == "customer"
        && r.rel_type == RelationshipType::DependsOn
        && r.line.is_none()));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "line-item"
            && r.rel_type == RelationshipType::DependsOn
            && r.line.is_none()));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "shipping-info"
            && r.rel_type == RelationshipType::DependsOn
            && r.line.is_none()));

    // Content wikilinks with section context
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "line-item"
            && r.rel_type == RelationshipType::RelatesTo
            && r.section == Some("attributes".into())));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "line-item#pricing"
            && r.rel_type == RelationshipType::DependsOn
            && r.section == Some("rules".into())));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "shipping-info"
            && r.rel_type == RelationshipType::RelatesTo
            && r.section == Some("rules".into())));
}

#[test]
fn parses_customer_fixture() {
    let path = fixtures_dir().join("customer.md");
    let artifact = parse_document_from_file(&path).expect("customer.md should parse");

    assert_eq!(artifact.slug, "customer");
    assert_eq!(artifact.title, "Customer");
    assert_eq!(artifact.tags, vec!["entity", "commerce", "core"]);

    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "order" && r.rel_type == RelationshipType::RelatesTo));
}

#[test]
fn parses_line_item_fixture() {
    let path = fixtures_dir().join("line-item.md");
    let artifact = parse_document_from_file(&path).expect("line-item.md should parse");

    assert_eq!(artifact.slug, "line-item");
    assert_eq!(artifact.title, "Line Item");
    assert_eq!(artifact.tags, vec!["entity", "commerce"]);

    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "order" && r.rel_type == RelationshipType::DependsOn));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "discount-rule" && r.rel_type == RelationshipType::RelatesTo));
}

#[test]
fn parses_shipping_info_fixture() {
    let path = fixtures_dir().join("shipping-info.md");
    let artifact = parse_document_from_file(&path).expect("shipping-info.md should parse");

    assert_eq!(artifact.slug, "shipping-info");
    assert_eq!(artifact.title, "Shipping Info");
    assert_eq!(artifact.tags, vec!["value-object", "commerce"]);

    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "order" && r.rel_type == RelationshipType::DependsOn));
    assert!(artifact
        .relationships
        .iter()
        .any(|r| r.target == "order" && r.rel_type == RelationshipType::RelatesTo));
}

#[test]
fn all_fixtures_produce_deterministic_hashes() {
    let dir = fixtures_dir();
    for name in &[
        "order.md",
        "customer.md",
        "line-item.md",
        "shipping-info.md",
    ] {
        let path = dir.join(name);
        let r1 = parse_document_from_file(&path).unwrap();
        let r2 = parse_document_from_file(&path).unwrap();
        assert_eq!(r1.hash, r2.hash, "non-deterministic hash for {name}");
        assert_eq!(r1.hash.len(), 64, "hash length for {name}");
    }
}
