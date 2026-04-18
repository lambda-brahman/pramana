// throwaway
//
// Q3/Q4: end-to-end search pipeline (embed → sqlite-vec → top-k) on corpus-a.
// Same model (gte-small) that pramana uses in production; dumps JSON results
// for comparison with the Bun baseline (spikes/104/bun-baseline.ts).

use anyhow::Result;
use ndarray::{Array, Array2};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::{params, Connection};
use serde_json::json;
use sqlite_vec::sqlite3_vec_init;
use std::fs;
use std::path::Path;
use tokenizers::{
    PaddingDirection, PaddingParams, PaddingStrategy, Tokenizer, TruncationDirection,
    TruncationParams, TruncationStrategy,
};
use zerocopy::AsBytes;

const MODEL: &[u8] = include_bytes!("../assets/gte-small/model.onnx");
const TOKENIZER: &[u8] = include_bytes!("../assets/gte-small/tokenizer.json");
const DIM: usize = 384;

type InitFn = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::os::raw::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int;

fn l2_normalize(v: &mut [f32]) {
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
    for x in v.iter_mut() {
        *x /= n;
    }
}

fn load_tokenizer() -> Result<Tokenizer> {
    let mut t =
        Tokenizer::from_bytes(TOKENIZER).map_err(|e| anyhow::anyhow!("tokenizer: {e}"))?;
    // Match transformers.js: use model_max_length (512) from tokenizer_config.json.
    // The embedded tokenizer.json has max_length=128 which over-truncates docs.
    t.with_truncation(Some(TruncationParams {
        max_length: 512,
        strategy: TruncationStrategy::LongestFirst,
        stride: 0,
        direction: TruncationDirection::Right,
    }))
    .map_err(|e| anyhow::anyhow!("truncation: {e}"))?;
    t.with_padding(Some(PaddingParams {
        strategy: PaddingStrategy::BatchLongest,
        direction: PaddingDirection::Right,
        pad_to_multiple_of: None,
        pad_id: 0,
        pad_type_id: 0,
        pad_token: "[PAD]".into(),
    }));
    Ok(t)
}

fn embed_batch(
    session: &mut Session,
    tokenizer: &Tokenizer,
    texts: &[String],
) -> Result<Vec<Vec<f32>>> {
    let encs = tokenizer
        .encode_batch(texts.iter().map(|s| s.as_str()).collect::<Vec<_>>(), true)
        .map_err(|e| anyhow::anyhow!("encode_batch: {e}"))?;

    let max_len = encs.iter().map(|e| e.len()).max().unwrap_or(0);
    let batch = texts.len();
    let mut ids = Array2::<i64>::zeros((batch, max_len));
    let mut mask = Array2::<i64>::zeros((batch, max_len));
    let mut type_ids = Array2::<i64>::zeros((batch, max_len));

    for (i, enc) in encs.iter().enumerate() {
        for (j, id) in enc.get_ids().iter().enumerate() {
            ids[[i, j]] = *id as i64;
        }
        for (j, m) in enc.get_attention_mask().iter().enumerate() {
            mask[[i, j]] = *m as i64;
        }
        for (j, t) in enc.get_type_ids().iter().enumerate() {
            type_ids[[i, j]] = *t as i64;
        }
    }

    let outputs = session.run(ort::inputs! {
        "input_ids" => Tensor::from_array(ids.clone())?,
        "attention_mask" => Tensor::from_array(mask.clone())?,
        "token_type_ids" => Tensor::from_array(type_ids)?,
    })?;

    let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
    let hidden = shape[2] as usize;
    let seq = shape[1] as usize;
    assert_eq!(hidden, DIM, "expected 384-dim");

    let hidden_states = Array::from_shape_vec((batch, seq, hidden), data.to_vec())?;
    let mask_f = mask.mapv(|x| x as f32);

    let mut embeddings = Vec::with_capacity(batch);
    for b in 0..batch {
        let mut pooled = vec![0f32; hidden];
        let mut total: f32 = 0.0;
        for s in 0..seq {
            let m = mask_f[[b, s]];
            if m <= 0.0 {
                continue;
            }
            total += m;
            for h in 0..hidden {
                pooled[h] += hidden_states[[b, s, h]] * m;
            }
        }
        if total > 0.0 {
            for x in pooled.iter_mut() {
                *x /= total;
            }
        }
        l2_normalize(&mut pooled);
        embeddings.push(pooled);
    }
    Ok(embeddings)
}

fn read_corpus(dir: &Path) -> Result<Vec<(String, String)>> {
    let mut docs = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.path());
    for entry in entries {
        let slug = entry
            .path()
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let text = fs::read_to_string(entry.path())?;
        docs.push((slug, text));
    }
    Ok(docs)
}

#[derive(serde::Deserialize, Debug, Clone)]
struct QueryEntry {
    query: String,
    category: String,
    relevant: Vec<String>,
    #[serde(default, rename = "partiallyRelevant")]
    partially_relevant: Vec<String>,
}

fn load_queries(path: &Path) -> Result<Vec<QueryEntry>> {
    let data = fs::read_to_string(path)?;
    let qs: Vec<QueryEntry> = serde_json::from_str(&data)?;
    Ok(qs)
}

fn top_k(
    conn: &Connection,
    qv: &[f32],
    k: usize,
) -> Result<Vec<(String, f64)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT slug, distance FROM vec_items
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance",
    )?;
    let rows: Vec<(String, f64)> = stmt
        .query_map(params![qv.as_bytes(), k as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn dcg(rel: &[f64]) -> f64 {
    rel.iter()
        .enumerate()
        .map(|(i, r)| (2f64.powf(*r) - 1.0) / ((i as f64 + 2.0).log2()))
        .sum()
}

fn relevance(q: &QueryEntry, slug: &str) -> f64 {
    if q.relevant.iter().any(|s| s == slug) {
        1.0
    } else if q.partially_relevant.iter().any(|s| s == slug) {
        0.5
    } else {
        0.0
    }
}

fn main() -> Result<()> {
    let corpus_dir = std::env::var("SPIKE_CORPUS_DIR")
        .unwrap_or_else(|_| "../../judged/fixtures/corpus-a".into());
    let queries_json = std::env::var("SPIKE_QUERIES_JSON")
        .unwrap_or_else(|_| "../../judged/corpora/corpus-a.queries.json".into());
    let output_json = std::env::var("SPIKE_OUTPUT_JSON")
        .unwrap_or_else(|_| "../../results/rust-corpus-a.json".into());

    unsafe {
        let init: InitFn = std::mem::transmute(sqlite3_vec_init as *const ());
        sqlite3_auto_extension(Some(init));
    }

    eprintln!("loading tokenizer + ONNX session...");
    let t_start = std::time::Instant::now();
    let tokenizer = load_tokenizer()?;
    let mut session = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(2)?
        .commit_from_memory(MODEL)?;
    let load_ms = t_start.elapsed().as_millis();
    eprintln!("  loaded in {load_ms} ms");

    let docs = read_corpus(Path::new(&corpus_dir))?;
    eprintln!("read {} docs from {}", docs.len(), corpus_dir);

    let t_doc = std::time::Instant::now();
    let doc_texts: Vec<String> = docs.iter().map(|(_, t)| t.clone()).collect();
    let doc_vecs = embed_batch(&mut session, &tokenizer, &doc_texts)?;
    let doc_embed_ms = t_doc.elapsed().as_millis();
    eprintln!(
        "embedded {} docs in {} ms ({:.1} ms/doc)",
        docs.len(),
        doc_embed_ms,
        doc_embed_ms as f64 / docs.len() as f64
    );

    let conn = Connection::open_in_memory()?;
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE vec_items USING vec0(slug TEXT PRIMARY KEY, embedding float[{DIM}] distance_metric=cosine);"
    ))?;

    for ((slug, _), v) in docs.iter().zip(doc_vecs.iter()) {
        conn.execute(
            "INSERT INTO vec_items(slug, embedding) VALUES (?, ?)",
            params![slug, v.as_bytes()],
        )?;
    }

    let queries = load_queries(Path::new(&queries_json))?;
    eprintln!("loaded {} queries", queries.len());

    let query_texts: Vec<String> = queries.iter().map(|q| q.query.clone()).collect();
    let t_q = std::time::Instant::now();
    let query_vecs = embed_batch(&mut session, &tokenizer, &query_texts)?;
    let q_embed_ms = t_q.elapsed().as_millis();
    eprintln!(
        "embedded {} queries in {} ms",
        queries.len(),
        q_embed_ms
    );

    let mut per_query = Vec::new();
    let mut top1 = 0;
    let mut rr_sum = 0.0;
    let mut ndcg_sum = 0.0;

    let t_search = std::time::Instant::now();
    for (q, qv) in queries.iter().zip(query_vecs.iter()) {
        let results = top_k(&conn, qv, 5)?;
        let slugs: Vec<String> = results.iter().map(|(s, _)| s.clone()).collect();
        let rels: Vec<f64> = slugs.iter().map(|s| relevance(q, s)).collect();

        let is_top1 = relevance(q, &slugs[0]) >= 1.0;
        if is_top1 {
            top1 += 1;
        }
        let rr = slugs
            .iter()
            .enumerate()
            .find(|(_, s)| relevance(q, s) >= 1.0)
            .map(|(i, _)| 1.0 / (i as f64 + 1.0))
            .unwrap_or(0.0);
        rr_sum += rr;

        let ideal_rels: Vec<f64> = {
            let mut r: Vec<f64> = q
                .relevant
                .iter()
                .map(|_| 1.0)
                .chain(q.partially_relevant.iter().map(|_| 0.5))
                .collect();
            r.sort_by(|a, b| b.partial_cmp(a).unwrap());
            r.truncate(5);
            r
        };
        let idcg = dcg(&ideal_rels);
        let ndcg = if idcg > 0.0 { dcg(&rels) / idcg } else { 0.0 };
        ndcg_sum += ndcg;

        per_query.push(json!({
            "query": q.query,
            "category": q.category,
            "top5": slugs,
            "distances": results.iter().map(|(_, d)| d).collect::<Vec<_>>(),
            "top1_hit": is_top1,
            "rr": rr,
            "ndcg5": ndcg,
        }));
    }
    let search_ms = t_search.elapsed().as_millis();
    eprintln!("searched {} queries in {} ms", queries.len(), search_ms);

    let n = queries.len() as f64;
    let summary = json!({
        "runtime": "rust+ort+sqlite-vec",
        "model": "Xenova/gte-small",
        "dim": DIM,
        "load_ms": load_ms,
        "doc_embed_ms": doc_embed_ms,
        "query_embed_ms": q_embed_ms,
        "search_ms": search_ms,
        "n_queries": queries.len(),
        "top1": top1 as f64 / n,
        "mrr": rr_sum / n,
        "ndcg5": ndcg_sum / n,
        "per_query": per_query,
    });

    if let Some(parent) = Path::new(&output_json).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output_json, serde_json::to_string_pretty(&summary)?)?;

    println!(
        "Q3/Q4 PASS: top1={:.3} mrr={:.3} ndcg5={:.3} (n={}) → {}",
        top1 as f64 / n,
        rr_sum / n,
        ndcg_sum / n,
        queries.len(),
        output_json
    );
    Ok(())
}
