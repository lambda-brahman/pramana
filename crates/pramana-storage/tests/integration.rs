use pramana_storage::*;

fn test_storage() -> Storage {
    let s = Storage::open(":memory:").unwrap();
    s.initialize().unwrap();
    s
}

fn test_storage_with_dim(dim: usize) -> Storage {
    let s = Storage::open_with_options(":memory:", Box::new(NoOpFilter), dim).unwrap();
    s.initialize().unwrap();
    s
}

fn sample_artifact(slug: &str, title: &str, content: &str) -> Artifact {
    Artifact {
        slug: slug.to_string(),
        title: title.to_string(),
        summary: Some(format!("Summary of {title}")),
        aliases: None,
        tags: vec!["test".to_string()],
        content: content.to_string(),
        hash: "abc123".to_string(),
        relationships: vec![],
        sections: vec![],
    }
}

// -- CRUD tests --

#[test]
fn insert_and_get_artifact() {
    let s = test_storage();
    let a = sample_artifact("rust-guide", "Rust Guide", "Learn Rust programming");
    s.insert_artifact(&a).unwrap();

    let got = s.get("rust-guide").unwrap().unwrap();
    assert_eq!(got.slug, "rust-guide");
    assert_eq!(got.title, "Rust Guide");
    assert_eq!(got.summary.as_deref(), Some("Summary of Rust Guide"));
    assert_eq!(got.content, "Learn Rust programming");
    assert_eq!(got.tags, vec!["test"]);
}

#[test]
fn get_missing_returns_none() {
    let s = test_storage();
    assert!(s.get("nonexistent").unwrap().is_none());
}

#[test]
fn insert_with_aliases() {
    let s = test_storage();
    let mut a = sample_artifact("rs", "Rust", "Content");
    a.aliases = Some(vec!["rust-lang".into(), "rustlang".into()]);
    s.insert_artifact(&a).unwrap();

    let got = s.get("rs").unwrap().unwrap();
    assert_eq!(
        got.aliases.as_deref(),
        Some(["rust-lang".to_string(), "rustlang".to_string()].as_slice())
    );
}

#[test]
fn insert_with_relationships_and_sections() {
    let s = test_storage();
    let a = Artifact {
        slug: "a".into(),
        title: "Article A".into(),
        summary: None,
        aliases: None,
        tags: vec!["doc".into()],
        content: "Content A".into(),
        hash: "h1".into(),
        relationships: vec![Relationship {
            target: "b".into(),
            kind: "references".into(),
            line: Some(10),
            section: Some("intro".into()),
        }],
        sections: vec![Section {
            id: "intro".into(),
            heading: "Introduction".into(),
            level: 1,
            line: 1,
        }],
    };
    s.insert_artifact(&a).unwrap();

    let got = s.get("a").unwrap().unwrap();
    assert_eq!(got.relationships.len(), 1);
    assert_eq!(got.relationships[0].target, "b");
    assert_eq!(got.relationships[0].kind, "references");
    assert_eq!(got.relationships[0].line, Some(10));
    assert_eq!(got.sections.len(), 1);
    assert_eq!(got.sections[0].heading, "Introduction");
}

#[test]
fn upsert_replaces_artifact() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact("x", "Old Title", "Old content"))
        .unwrap();
    s.insert_artifact(&sample_artifact("x", "New Title", "New content"))
        .unwrap();

    let got = s.get("x").unwrap().unwrap();
    assert_eq!(got.title, "New Title");
    assert_eq!(got.content, "New content");
    assert_eq!(s.count_artifacts().unwrap(), 1);
}

// -- List / filter tests --

#[test]
fn list_all_artifacts() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact("a", "A", "a")).unwrap();
    s.insert_artifact(&sample_artifact("b", "B", "b")).unwrap();
    let all = s.list(None).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn list_filters_by_tag() {
    let s = test_storage();
    let mut a1 = sample_artifact("a", "A", "a");
    a1.tags = vec!["rust".into(), "guide".into()];
    let mut a2 = sample_artifact("b", "B", "b");
    a2.tags = vec!["python".into()];
    s.insert_artifact(&a1).unwrap();
    s.insert_artifact(&a2).unwrap();

    let rust_only = s.list(Some(&["rust".into()])).unwrap();
    assert_eq!(rust_only.len(), 1);
    assert_eq!(rust_only[0].slug, "a");

    let both_tags = s.list(Some(&["rust".into(), "guide".into()])).unwrap();
    assert_eq!(both_tags.len(), 1);

    let no_match = s.list(Some(&["java".into()])).unwrap();
    assert!(no_match.is_empty());
}

// -- Relationship tests --

#[test]
fn get_relationships() {
    let s = test_storage();
    let a = Artifact {
        slug: "src".into(),
        title: "Source".into(),
        summary: None,
        aliases: None,
        tags: vec!["doc".into()],
        content: "c".into(),
        hash: "h".into(),
        relationships: vec![
            Relationship {
                target: "tgt1".into(),
                kind: "references".into(),
                line: None,
                section: None,
            },
            Relationship {
                target: "tgt2".into(),
                kind: "extends".into(),
                line: Some(5),
                section: None,
            },
        ],
        sections: vec![],
    };
    s.insert_artifact(&a).unwrap();

    let rels = s.get_relationships("src").unwrap();
    assert_eq!(rels.len(), 2);
}

#[test]
fn get_inverse_relationships() {
    let s = test_storage();
    let a = Artifact {
        slug: "src".into(),
        title: "Source".into(),
        summary: None,
        aliases: None,
        tags: vec!["doc".into()],
        content: "c".into(),
        hash: "h".into(),
        relationships: vec![Relationship {
            target: "tgt".into(),
            kind: "references".into(),
            line: None,
            section: None,
        }],
        sections: vec![],
    };
    s.insert_artifact(&a).unwrap();

    let inverse = s.get_inverse("tgt").unwrap();
    assert_eq!(inverse.len(), 1);
    assert_eq!(inverse[0].target, "src");
}

#[test]
fn get_inverse_matches_section_targets() {
    let s = test_storage();
    let a = Artifact {
        slug: "src".into(),
        title: "Source".into(),
        summary: None,
        aliases: None,
        tags: vec!["doc".into()],
        content: "c".into(),
        hash: "h".into(),
        relationships: vec![Relationship {
            target: "tgt#section-1".into(),
            kind: "references".into(),
            line: None,
            section: None,
        }],
        sections: vec![],
    };
    s.insert_artifact(&a).unwrap();

    let inverse = s.get_inverse("tgt").unwrap();
    assert_eq!(inverse.len(), 1);
}

// -- FTS search tests --

#[test]
fn fts_search_finds_by_content() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact(
        "rust-guide",
        "Rust Programming Guide",
        "Learn systems programming with Rust language",
    ))
    .unwrap();
    s.insert_artifact(&sample_artifact(
        "python-guide",
        "Python Tutorial",
        "Learn scripting with Python language",
    ))
    .unwrap();

    let results = s.fts_search("rust programming").unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].slug, "rust-guide");
}

#[test]
fn fts_search_finds_by_title() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact(
        "a",
        "Kubernetes Deployment",
        "Deploy apps",
    ))
    .unwrap();

    let results = s.fts_search("kubernetes").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].slug, "a");
}

#[test]
fn fts_search_empty_query_returns_empty() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact("a", "Title", "Content"))
        .unwrap();
    let results = s.fts_search("").unwrap();
    assert!(results.is_empty());
}

#[test]
fn fts_search_with_stop_word_filter() {
    struct EnglishFilter;
    impl StopWordFilter for EnglishFilter {
        fn is_stop_word(&self, word: &str) -> bool {
            matches!(word, "how" | "does" | "the" | "is" | "a" | "to" | "with")
        }
    }

    let s = Storage::open_with_options(":memory:", Box::new(EnglishFilter), 384).unwrap();
    s.initialize().unwrap();
    s.insert_artifact(&sample_artifact(
        "search-doc",
        "Search Architecture",
        "How search works with indexing and retrieval",
    ))
    .unwrap();

    let results = s.fts_search("how does search work").unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].slug, "search-doc");
}

// -- Vec search tests --

#[test]
fn vec_search_finds_nearest() {
    let dim = 4;
    let s = test_storage_with_dim(dim);
    s.insert_artifact(&sample_artifact("a", "A", "a")).unwrap();
    s.insert_artifact(&sample_artifact("b", "B", "b")).unwrap();

    // a is close to [1,0,0,0], b is close to [0,1,0,0]
    s.insert_embedding("a", &[1.0, 0.0, 0.0, 0.0]).unwrap();
    s.insert_embedding("b", &[0.0, 1.0, 0.0, 0.0]).unwrap();

    let results = s.vec_search(&[0.9, 0.1, 0.0, 0.0], 10).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].slug, "a");
}

#[test]
fn vec_search_rejects_wrong_dimension() {
    let s = test_storage_with_dim(4);
    let err = s.vec_search(&[1.0, 0.0], 10);
    assert!(err.is_err());
    match err.unwrap_err() {
        StorageError::InvalidDimension { expected, got } => {
            assert_eq!(expected, 4);
            assert_eq!(got, 2);
        }
        other => panic!("expected InvalidDimension, got {other:?}"),
    }
}

#[test]
fn insert_embedding_rejects_wrong_dimension() {
    let s = test_storage_with_dim(4);
    let err = s.insert_embedding("slug", &[1.0, 0.0]);
    assert!(err.is_err());
}

// -- Hybrid search tests --

#[test]
fn hybrid_search_without_vec_returns_fts() {
    let s = test_storage();
    s.insert_artifact(&sample_artifact("a", "Rust Guide", "Learn Rust"))
        .unwrap();

    let results = s.hybrid_search("rust", None).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].slug, "a");
}

#[test]
fn hybrid_search_fuses_fts_and_vec() {
    let dim = 4;
    let s = test_storage_with_dim(dim);

    // "fts-only" has relevant text but distant vector
    s.insert_artifact(&sample_artifact(
        "fts-only",
        "Compilation Guide",
        "Guide to compilation and compilers",
    ))
    .unwrap();
    s.insert_embedding("fts-only", &[0.0, 0.0, 0.0, 1.0])
        .unwrap();

    // "vec-only" has irrelevant text but close vector
    s.insert_artifact(&sample_artifact(
        "vec-only",
        "Misc Notes",
        "Random content here",
    ))
    .unwrap();
    s.insert_embedding("vec-only", &[1.0, 0.0, 0.0, 0.0])
        .unwrap();

    // "both" has relevant text AND close vector
    s.insert_artifact(&sample_artifact(
        "both",
        "Compilers and Compilation",
        "All about compilers and the compilation process",
    ))
    .unwrap();
    s.insert_embedding("both", &[0.9, 0.1, 0.0, 0.0]).unwrap();

    let results = s
        .hybrid_search("compilation compilers", Some(&[1.0, 0.0, 0.0, 0.0]))
        .unwrap();
    assert!(!results.is_empty());
    // "both" appears in both FTS and vec results → highest RRF score
    assert_eq!(results[0].slug, "both");
}

// -- Close test --

#[test]
fn close_succeeds() {
    let s = test_storage();
    s.close().unwrap();
}

// -- Schema parity test --

#[test]
fn schema_tables_match_ts() {
    let s = test_storage();

    // Verify all expected tables exist by inserting and querying
    s.insert_artifact(&Artifact {
        slug: "test".into(),
        title: "Test".into(),
        summary: Some("sum".into()),
        aliases: Some(vec!["alias1".into()]),
        tags: vec!["tag1".into(), "tag2".into()],
        content: "content".into(),
        hash: "hash123".into(),
        relationships: vec![Relationship {
            target: "other".into(),
            kind: "references".into(),
            line: Some(42),
            section: Some("intro".into()),
        }],
        sections: vec![Section {
            id: "intro".into(),
            heading: "Introduction".into(),
            level: 1,
            line: 1,
        }],
    })
    .unwrap();

    let got = s.get("test").unwrap().unwrap();
    assert_eq!(got.aliases, Some(vec!["alias1".to_string()]));
    assert_eq!(got.tags, vec!["tag1", "tag2"]);
    assert_eq!(got.relationships[0].line, Some(42));
    assert_eq!(got.sections[0].level, 1);

    // FTS works
    let fts = s.fts_search("content").unwrap();
    assert_eq!(fts.len(), 1);

    // Vec table exists (use non-zero vectors to avoid undefined cosine distance)
    s.insert_embedding("test", &[1.0; 384]).unwrap();
    let vec_results = s.vec_search(&[1.0; 384], 5).unwrap();
    assert!(!vec_results.is_empty());
}

// -- RRF accuracy test (reproduces #91 judged-set concept) --

#[test]
fn rrf_accuracy_known_corpus() {
    let dim = 4;
    let s = test_storage_with_dim(dim);

    let docs = [
        (
            "sqlite-fts5",
            "SQLite FTS5 Search Extension",
            "FTS5 is a search extension for SQLite databases enabling ranked text retrieval",
        ),
        (
            "sqlite-vec",
            "SQLite Vector Search",
            "sqlite vec provides vector similarity search using cosine distance metrics",
        ),
        (
            "hybrid-search",
            "Hybrid Search with RRF",
            "Reciprocal rank fusion combines text and semantic search results",
        ),
        (
            "rust-sqlite",
            "Rust SQLite Bindings",
            "rusqlite provides safe Rust bindings to the SQLite database engine",
        ),
        (
            "embedding-models",
            "Embedding Models",
            "Neural embedding models convert text into dense vector representations",
        ),
    ];

    for (slug, title, content) in &docs {
        s.insert_artifact(&sample_artifact(slug, title, content))
            .unwrap();
    }

    // Synthetic embeddings: docs about search are close together in vector space
    s.insert_embedding("sqlite-fts5", &[0.8, 0.5, 0.1, 0.0])
        .unwrap();
    s.insert_embedding("sqlite-vec", &[0.7, 0.6, 0.2, 0.0])
        .unwrap();
    s.insert_embedding("hybrid-search", &[0.9, 0.4, 0.1, 0.0])
        .unwrap();
    s.insert_embedding("rust-sqlite", &[0.3, 0.2, 0.8, 0.1])
        .unwrap();
    s.insert_embedding("embedding-models", &[0.5, 0.7, 0.3, 0.0])
        .unwrap();

    // Query: "FTS5 search SQLite" with vector close to search docs
    let results = s
        .hybrid_search("FTS5 search SQLite", Some(&[0.85, 0.45, 0.1, 0.0]))
        .unwrap();

    // Top-1 must be sqlite-fts5 (strong FTS match + close vector)
    assert!(!results.is_empty());
    assert_eq!(
        results[0].slug, "sqlite-fts5",
        "top-1 should be the FTS5 doc for 'FTS5 search SQLite' query"
    );

    // hybrid-search should appear (has "search" in text + close vector)
    let slugs: Vec<&str> = results.iter().map(|r| r.slug.as_str()).collect();
    assert!(
        slugs.contains(&"hybrid-search"),
        "hybrid-search doc should appear in results"
    );
}
