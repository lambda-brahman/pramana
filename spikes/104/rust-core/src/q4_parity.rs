// throwaway — q4 variant that loads the model from disk (lazy-download shape).
// Used purely to measure binary size delta vs the embedded binary.
//
// Same as q3-search but model/tokenizer are read from a path passed via env,
// instead of include_bytes!. Numerical output should be identical.

use anyhow::Result;
use ndarray::{Array, Array2};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::{params, Connection};
use sqlite_vec::sqlite3_vec_init;
use std::fs;
use std::path::Path;
use tokenizers::{
    PaddingDirection, PaddingParams, PaddingStrategy, Tokenizer, TruncationDirection,
    TruncationParams, TruncationStrategy,
};
use zerocopy::AsBytes;

type InitFn = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::os::raw::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int;

const DIM: usize = 384;

fn l2n(v: &mut [f32]) {
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
    for x in v.iter_mut() {
        *x /= n;
    }
}

fn main() -> Result<()> {
    let model_path = std::env::var("SPIKE_MODEL_PATH")
        .unwrap_or_else(|_| "../assets/gte-small/model.onnx".into());
    let tokenizer_path = std::env::var("SPIKE_TOKENIZER_PATH")
        .unwrap_or_else(|_| "../assets/gte-small/tokenizer.json".into());

    unsafe {
        let init: InitFn = std::mem::transmute(sqlite3_vec_init as *const ());
        sqlite3_auto_extension(Some(init));
    }

    let tokenizer_bytes = fs::read(&tokenizer_path)?;
    let mut tokenizer = Tokenizer::from_bytes(&tokenizer_bytes)
        .map_err(|e| anyhow::anyhow!("tokenizer: {e}"))?;
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: 512,
            strategy: TruncationStrategy::LongestFirst,
            stride: 0,
            direction: TruncationDirection::Right,
        }))
        .map_err(|e| anyhow::anyhow!("trunc: {e}"))?;
    tokenizer.with_padding(Some(PaddingParams {
        strategy: PaddingStrategy::BatchLongest,
        direction: PaddingDirection::Right,
        pad_to_multiple_of: None,
        pad_id: 0,
        pad_type_id: 0,
        pad_token: "[PAD]".into(),
    }));

    let mut session = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(1)?
        .commit_from_file(&model_path)?;

    let text = "smoke test";
    let enc = tokenizer
        .encode(text, true)
        .map_err(|e| anyhow::anyhow!("encode: {e}"))?;
    let ids: Vec<i64> = enc.get_ids().iter().map(|x| *x as i64).collect();
    let mask: Vec<i64> = enc.get_attention_mask().iter().map(|x| *x as i64).collect();
    let type_ids: Vec<i64> = enc.get_type_ids().iter().map(|x| *x as i64).collect();
    let seq = ids.len();

    let outputs = session.run(ort::inputs! {
        "input_ids" => Tensor::from_array(Array2::from_shape_vec((1, seq), ids)?)?,
        "attention_mask" => Tensor::from_array(Array2::from_shape_vec((1, seq), mask.clone())?)?,
        "token_type_ids" => Tensor::from_array(Array2::from_shape_vec((1, seq), type_ids)?)?,
    })?;

    let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
    let hidden = shape[2] as usize;
    let s = shape[1] as usize;
    let hs = Array::from_shape_vec((1, s, hidden), data.to_vec())?;
    let mask_f: Vec<f32> = mask.iter().map(|x| *x as f32).collect();

    let mut pooled = vec![0f32; hidden];
    let mut tot = 0.0;
    for i in 0..s {
        if mask_f[i] <= 0.0 {
            continue;
        }
        tot += mask_f[i];
        for h in 0..hidden {
            pooled[h] += hs[[0, i, h]] * mask_f[i];
        }
    }
    for x in pooled.iter_mut() {
        *x /= tot;
    }
    l2n(&mut pooled);
    assert_eq!(pooled.len(), DIM);

    let conn = Connection::open_in_memory()?;
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE vec_items USING vec0(slug TEXT PRIMARY KEY, embedding float[{DIM}] distance_metric=cosine);"
    ))?;
    conn.execute(
        "INSERT INTO vec_items(slug, embedding) VALUES (?, ?)",
        params!["smoke", pooled.as_bytes()],
    )?;
    let _ = Path::new(".").exists();
    println!(
        "q4-parity OK — lazy-load shape, model={}, first head={:.4}",
        model_path, pooled[0]
    );
    Ok(())
}
