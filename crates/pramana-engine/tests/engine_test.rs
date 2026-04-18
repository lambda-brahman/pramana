use pramana_engine::{Builder, ListFilter, Reader, TenantConfig, TenantManager};
use pramana_storage::{Artifact, Relationship, Section, Storage};
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures")
}

fn setup_storage() -> Storage {
    let storage = Storage::open(":memory:").unwrap();
    storage.initialize().unwrap();
    storage
}

fn setup_with_fixtures() -> Storage {
    let storage = setup_storage();
    let builder = Builder::new(&storage);
    let report = builder.ingest(&fixtures_dir()).unwrap();
    assert_eq!(
        report.failed.len(),
        0,
        "fixture parse failures: {:?}",
        report.failed
    );
    assert!(report.succeeded > 0);
    storage
}

// --- Builder tests ---

#[test]
fn builder_ingests_all_fixtures() {
    let storage = setup_storage();
    let builder = Builder::new(&storage);
    let report = builder.ingest(&fixtures_dir()).unwrap();

    assert_eq!(report.total, 4);
    assert_eq!(report.succeeded, 4);
    assert!(report.failed.is_empty());
}

#[test]
fn builder_report_counts_failures() {
    let storage = setup_storage();
    let builder = Builder::new(&storage);
    let report = builder.ingest(Path::new("/nonexistent/path")).unwrap();

    assert_eq!(report.total, 0);
    assert_eq!(report.succeeded, 0);
}

// --- Reader::get tests ---

#[test]
fn get_existing_artifact() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let view = reader.get("order").unwrap().unwrap();
    assert_eq!(view.slug, "order");
    assert_eq!(view.title, "Order");
    assert_eq!(view.tags, vec!["entity", "commerce", "core"]);
    assert!(view.summary.is_some());
    assert!(!view.relationships.is_empty());
    assert!(!view.hash.is_empty());
}

#[test]
fn get_nonexistent_artifact() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    assert!(reader.get("does-not-exist").unwrap().is_none());
}

#[test]
fn get_with_section_id() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let view = reader.get("order#attributes").unwrap().unwrap();
    assert_eq!(view.slug, "order");
    let focused = view.focused_section.unwrap();
    assert_eq!(focused.id, "attributes");
    assert!(focused.content.contains("lineItems"));
}

#[test]
fn get_with_nonexistent_section() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let view = reader.get("order#nonexistent").unwrap().unwrap();
    assert_eq!(view.slug, "order");
    assert!(view.focused_section.is_none());
}

#[test]
fn get_populates_inverse_relationships() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let view = reader.get("customer").unwrap().unwrap();
    assert!(
        !view.inverse_relationships.is_empty(),
        "customer should have inverse relationships from order's depends-on"
    );
}

// --- Reader::search tests ---

#[test]
fn search_returns_matching_results() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.search("order purchase", None).unwrap();
    assert!(!results.is_empty());
}

#[test]
fn search_empty_query() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.search("", None).unwrap();
    assert!(results.is_empty());
}

// --- Reader::traverse tests ---

#[test]
fn traverse_depth_1_follows_direct_relationships() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("order", None, 1).unwrap();
    let slugs: Vec<&str> = results.iter().map(|v| v.slug.as_str()).collect();

    assert!(slugs.contains(&"customer"), "order depends-on customer");
    assert!(slugs.contains(&"line-item"), "order depends-on line-item");
    assert!(
        slugs.contains(&"shipping-info"),
        "order depends-on shipping-info"
    );
}

#[test]
fn traverse_excludes_starting_node() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("order", None, 1).unwrap();
    assert!(
        !results.iter().any(|v| v.slug == "order"),
        "starting node should not appear in results"
    );
}

#[test]
fn traverse_depth_0_returns_empty() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("order", None, 0).unwrap();
    assert!(results.is_empty());
}

#[test]
fn traverse_filters_by_relationship_type() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("customer", Some("depends-on"), 1).unwrap();
    assert!(
        results.is_empty(),
        "customer has no depends-on relationships in frontmatter"
    );

    let results = reader.traverse("customer", Some("relates-to"), 1).unwrap();
    let slugs: Vec<&str> = results.iter().map(|v| v.slug.as_str()).collect();
    assert!(slugs.contains(&"order"), "customer relates-to order");
}

#[test]
fn traverse_prevents_cycles() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("order", None, 3).unwrap();
    let mut seen = std::collections::HashSet::new();
    for view in &results {
        assert!(
            seen.insert(&view.slug),
            "duplicate slug in traversal: {}",
            view.slug
        );
    }
}

#[test]
fn traverse_nonexistent_start() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.traverse("nonexistent", None, 1).unwrap();
    assert!(results.is_empty());
}

// --- Reader::list tests ---

#[test]
fn list_all_artifacts() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.list(None).unwrap();
    assert_eq!(results.len(), 4);
}

#[test]
fn list_with_single_tag_filter() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let filter = ListFilter {
        tags: Some(vec!["core".to_string()]),
    };
    let results = reader.list(Some(&filter)).unwrap();
    assert!(results.len() >= 2);
    for view in &results {
        assert!(view.tags.contains(&"core".to_string()));
    }
}

#[test]
fn list_with_intersection_tag_filter() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let filter = ListFilter {
        tags: Some(vec!["entity".to_string(), "core".to_string()]),
    };
    let results = reader.list(Some(&filter)).unwrap();
    for view in &results {
        assert!(view.tags.contains(&"entity".to_string()));
        assert!(view.tags.contains(&"core".to_string()));
    }
}

#[test]
fn list_with_no_matching_tags() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let filter = ListFilter {
        tags: Some(vec!["nonexistent-tag".to_string()]),
    };
    let results = reader.list(Some(&filter)).unwrap();
    assert!(results.is_empty());
}

#[test]
fn list_enriches_with_inverse_relationships() {
    let storage = setup_with_fixtures();
    let reader = Reader::new(&storage);

    let results = reader.list(None).unwrap();
    let customer = results.iter().find(|v| v.slug == "customer").unwrap();
    assert!(
        !customer.inverse_relationships.is_empty(),
        "customer should have inverse relationships"
    );
}

// --- TenantManager tests ---

#[test]
fn tenant_mount_and_read() {
    let mut mgr = TenantManager::new();
    let report = mgr
        .mount(TenantConfig {
            name: "test-tenant".into(),
            source_dir: fixtures_dir().to_string_lossy().into_owned(),
        })
        .unwrap();

    assert_eq!(report.succeeded, 4);
    assert!(mgr.has_tenant("test-tenant"));

    let reader = mgr.reader("test-tenant").unwrap();
    let view = reader.get("order").unwrap().unwrap();
    assert_eq!(view.slug, "order");
}

#[test]
fn tenant_reader_for_nonexistent_tenant() {
    let mgr = TenantManager::new();
    assert!(mgr.reader("nonexistent").is_err());
}

#[test]
fn tenant_duplicate_name_rejected() {
    let mut mgr = TenantManager::new();
    let dir = fixtures_dir().to_string_lossy().into_owned();

    let _ = mgr
        .mount(TenantConfig {
            name: "abc".into(),
            source_dir: dir.clone(),
        })
        .unwrap();

    assert!(mgr
        .mount(TenantConfig {
            name: "abc".into(),
            source_dir: dir,
        })
        .is_err());
}

#[test]
fn tenant_name_validation_rejects_invalid() {
    let mut mgr = TenantManager::new();
    let dir = fixtures_dir().to_string_lossy().into_owned();

    assert!(mgr
        .mount(TenantConfig {
            name: "".into(),
            source_dir: dir.clone()
        })
        .is_err());
    assert!(mgr
        .mount(TenantConfig {
            name: "1bad".into(),
            source_dir: dir.clone()
        })
        .is_err());
    assert!(mgr
        .mount(TenantConfig {
            name: "Bad".into(),
            source_dir: dir.clone()
        })
        .is_err());
    assert!(mgr
        .mount(TenantConfig {
            name: "get".into(),
            source_dir: dir.clone()
        })
        .is_err());
    assert!(mgr
        .mount(TenantConfig {
            name: "search".into(),
            source_dir: dir
        })
        .is_err());
}

#[test]
fn tenant_nonexistent_source_dir() {
    let mut mgr = TenantManager::new();
    assert!(mgr
        .mount(TenantConfig {
            name: "bad-dir".into(),
            source_dir: "/nonexistent/path".into(),
        })
        .is_err());
}

#[test]
fn tenant_unmount() {
    let mut mgr = TenantManager::new();
    let _ = mgr
        .mount(TenantConfig {
            name: "removeme".into(),
            source_dir: fixtures_dir().to_string_lossy().into_owned(),
        })
        .unwrap();

    assert!(mgr.has_tenant("removeme"));
    mgr.unmount("removeme").unwrap();
    assert!(!mgr.has_tenant("removeme"));
}

#[test]
fn tenant_unmount_nonexistent() {
    let mut mgr = TenantManager::new();
    assert!(mgr.unmount("nonexistent").is_err());
}

#[test]
fn tenant_list_and_names() {
    let mut mgr = TenantManager::new();
    let dir = fixtures_dir().to_string_lossy().into_owned();

    let _ = mgr
        .mount(TenantConfig {
            name: "alpha".into(),
            source_dir: dir.clone(),
        })
        .unwrap();
    let _ = mgr
        .mount(TenantConfig {
            name: "beta".into(),
            source_dir: dir,
        })
        .unwrap();

    let names = mgr.tenant_names();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"alpha".to_string()));
    assert!(names.contains(&"beta".to_string()));

    let infos = mgr.list_tenants();
    assert_eq!(infos.len(), 2);
    for info in &infos {
        assert_eq!(info.artifact_count, 4);
    }
}

#[test]
fn tenant_reload() {
    let mut mgr = TenantManager::new();
    let _ = mgr
        .mount(TenantConfig {
            name: "reloadable".into(),
            source_dir: fixtures_dir().to_string_lossy().into_owned(),
        })
        .unwrap();

    let report = mgr.reload("reloadable").unwrap();
    assert_eq!(report.succeeded, 4);

    let reader = mgr.reader("reloadable").unwrap();
    assert!(reader.get("order").unwrap().is_some());
}

#[test]
fn tenant_reload_nonexistent() {
    let mut mgr = TenantManager::new();
    assert!(mgr.reload("nonexistent").is_err());
}

#[test]
fn tenant_isolation_between_tenants() {
    let mut mgr = TenantManager::new();
    let dir = fixtures_dir().to_string_lossy().into_owned();

    let _ = mgr
        .mount(TenantConfig {
            name: "tenant-a".into(),
            source_dir: dir.clone(),
        })
        .unwrap();
    let _ = mgr
        .mount(TenantConfig {
            name: "tenant-b".into(),
            source_dir: dir,
        })
        .unwrap();

    let reader_a = mgr.reader("tenant-a").unwrap();
    let reader_b = mgr.reader("tenant-b").unwrap();

    let list_a = reader_a.list(None).unwrap();
    let list_b = reader_b.list(None).unwrap();

    assert_eq!(list_a.len(), list_b.len());
    assert_eq!(list_a.len(), 4);
}

// --- Batch performance tests ---

fn setup_large_storage(count: usize) -> Storage {
    let storage = setup_storage();
    for i in 0..count {
        let artifact = Artifact {
            slug: format!("artifact-{i}"),
            title: format!("Artifact {i}"),
            summary: Some(format!("Summary {i}")),
            aliases: None,
            tags: vec![
                "generated".into(),
                if i % 2 == 0 {
                    "even".into()
                } else {
                    "odd".into()
                },
            ],
            content: format!("Content for artifact {i}"),
            hash: format!("hash-{i}"),
            relationships: if i > 0 {
                vec![Relationship {
                    target: format!("artifact-{}", i - 1),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                }]
            } else {
                vec![]
            },
            sections: vec![Section {
                id: "main".into(),
                heading: "Main Section".into(),
                level: 1,
                line: 1,
            }],
        };
        storage.insert_artifact(&artifact).unwrap();
    }
    storage
}

#[test]
fn list_scales_with_batch_queries() {
    let storage = setup_large_storage(1100);
    let reader = Reader::new(&storage);

    let start = std::time::Instant::now();
    let all = reader.list(None).unwrap();
    let list_all = start.elapsed();

    assert_eq!(all.len(), 1100);

    let start = std::time::Instant::now();
    let filter = ListFilter {
        tags: Some(vec!["even".to_string()]),
    };
    let even = reader.list(Some(&filter)).unwrap();
    let list_filtered = start.elapsed();

    assert_eq!(even.len(), 550);
    for view in &even {
        assert!(view.tags.contains(&"even".to_string()));
    }

    let artifact_1 = all.iter().find(|v| v.slug == "artifact-1").unwrap();
    assert!(
        !artifact_1.inverse_relationships.is_empty(),
        "artifact-1 should have inverse relationship from artifact-2"
    );

    eprintln!("list(None) 1100 artifacts: {list_all:?}");
    eprintln!("list(tags=[even]) 1100 artifacts: {list_filtered:?}");
}

#[test]
fn traverse_scales_with_batch_queries() {
    let storage = setup_large_storage(100);
    let reader = Reader::new(&storage);

    let start = std::time::Instant::now();
    let results = reader.traverse("artifact-99", None, 5).unwrap();
    let elapsed = start.elapsed();

    assert!(!results.is_empty());
    for view in &results {
        assert!(!view.inverse_relationships.is_empty() || view.slug == "artifact-0");
    }

    eprintln!("traverse(depth=5) over 100-node chain: {elapsed:?}");
}

#[test]
fn list_tag_filter_pushes_to_sql() {
    let storage = setup_large_storage(100);
    let reader = Reader::new(&storage);

    let filter = ListFilter {
        tags: Some(vec!["nonexistent-tag".to_string()]),
    };
    let results = reader.list(Some(&filter)).unwrap();
    assert!(results.is_empty());

    let filter = ListFilter {
        tags: Some(vec!["generated".to_string(), "even".to_string()]),
    };
    let results = reader.list(Some(&filter)).unwrap();
    assert_eq!(results.len(), 50);
    for view in &results {
        assert!(view.tags.contains(&"generated".to_string()));
        assert!(view.tags.contains(&"even".to_string()));
    }
}
