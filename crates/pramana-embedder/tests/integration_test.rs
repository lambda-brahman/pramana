use pramana_embedder::{cosine_similarity, Embedder, DEFAULT_MODEL};

fn load_default_model() -> Embedder {
    Embedder::load(DEFAULT_MODEL).expect("failed to load model")
}

#[test]
#[ignore]
fn embed_produces_384_dim_unit_vector() {
    let embedder = load_default_model();
    assert_eq!(embedder.dim(), 384);

    let vec = embedder
        .embed_query("The quick brown fox jumps over the lazy dog")
        .expect("embed_query failed");

    assert_eq!(vec.len(), 384, "expected 384-dim vector, got {}", vec.len());

    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!(
        (norm - 1.0).abs() < 1e-4,
        "expected unit vector (norm ≈ 1.0), got {norm}"
    );

    assert!(
        vec.iter().all(|x| x.is_finite()),
        "embedding contains non-finite values"
    );
}

#[test]
#[ignore]
fn similar_texts_rank_higher_than_dissimilar() {
    let embedder = load_default_model();

    let anchor = embedder
        .embed_query("Rust is a systems programming language")
        .expect("anchor embed failed");
    let similar = embedder
        .embed_query("Rust focuses on memory safety and performance")
        .expect("similar embed failed");
    let dissimilar = embedder
        .embed_query("The recipe calls for two cups of flour and one egg")
        .expect("dissimilar embed failed");

    let sim_similar = cosine_similarity(&anchor, &similar);
    let sim_dissimilar = cosine_similarity(&anchor, &dissimilar);

    assert!(
        sim_similar > sim_dissimilar,
        "expected similar text ({sim_similar:.4}) to score higher than dissimilar ({sim_dissimilar:.4})"
    );

    assert!(
        sim_similar > 0.5,
        "expected similar-text similarity > 0.5, got {sim_similar:.4}"
    );
    assert!(
        sim_dissimilar < 0.5,
        "expected dissimilar-text similarity < 0.5, got {sim_dissimilar:.4}"
    );
}

#[test]
#[ignore]
fn embed_batch_returns_correct_count_and_dimensions() {
    let embedder = load_default_model();

    let texts = &[
        "first document about machine learning",
        "second document about cooking",
        "third document about space exploration",
    ];

    let embeddings = embedder.embed_batch(texts).expect("embed_batch failed");

    assert_eq!(embeddings.len(), 3, "expected 3 embeddings");
    for (i, emb) in embeddings.iter().enumerate() {
        assert_eq!(emb.len(), 384, "embedding {i} has wrong dimension");
        let norm: f32 = emb.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(
            (norm - 1.0).abs() < 1e-4,
            "embedding {i} is not a unit vector (norm = {norm})"
        );
    }
}

#[test]
#[ignore]
fn identical_text_produces_identical_embedding() {
    let embedder = load_default_model();

    let text = "deterministic embedding test";
    let a = embedder.embed_query(text).expect("first embed failed");
    let b = embedder.embed_query(text).expect("second embed failed");

    let sim = cosine_similarity(&a, &b);
    assert!(
        (sim - 1.0).abs() < 1e-5,
        "identical text should produce cosine similarity ≈ 1.0, got {sim}"
    );
    assert_eq!(a, b, "identical text should produce identical vectors");
}

#[test]
#[ignore]
fn empty_batch_returns_empty_vec() {
    let embedder = load_default_model();
    let result = embedder.embed_batch(&[]).expect("empty batch failed");
    assert!(result.is_empty());
}

#[test]
#[ignore]
fn embed_query_matches_embed_batch_for_gte() {
    let embedder = load_default_model();

    let text = "query vs batch consistency check";
    let query_vec = embedder.embed_query(text).expect("embed_query failed");
    let batch_vecs = embedder.embed_batch(&[text]).expect("embed_batch failed");

    assert_eq!(batch_vecs.len(), 1);
    assert_eq!(
        query_vec, batch_vecs[0],
        "embed_query and embed_batch should produce identical results for GTE (no query prefix)"
    );
}
