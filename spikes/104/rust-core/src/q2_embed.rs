// throwaway
//
// Q2: prove we can run gte-small via ort+tokenizers and produce a 384-dim embedding.
// Model + tokenizer are loaded via include_bytes! so the binary is self-contained
// (gitignored — seeded from ~/.cache/pramana/models/Xenova/gte-small/).

use anyhow::{Context, Result};
use ndarray::{Array, Array2};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::Tokenizer;

const MODEL: &[u8] = include_bytes!("../assets/gte-small/model.onnx");
const TOKENIZER: &[u8] = include_bytes!("../assets/gte-small/tokenizer.json");

fn l2_normalize(v: &mut [f32]) {
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
    for x in v.iter_mut() {
        *x /= n;
    }
}

fn embed(session: &mut Session, tokenizer: &Tokenizer, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
    let encs = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| anyhow::anyhow!("encode_batch: {e}"))?;

    let max_len = encs.iter().map(|e| e.len()).max().unwrap_or(0);
    let batch = texts.len();
    let pad = tokenizer.get_padding().and_then(|p| Some(p.pad_id)).unwrap_or(0) as i64;

    let mut ids = Array2::<i64>::from_elem((batch, max_len), pad);
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

    // last_hidden_state: (batch, seq, hidden)
    let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
    let hidden = shape[2] as usize;
    let seq = shape[1] as usize;

    let hidden_states = Array::from_shape_vec((batch, seq, hidden), data.to_vec())?;
    let mask_f = mask.mapv(|x| x as f32);

    // Mean pooling with attention mask
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(batch);
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

fn main() -> Result<()> {
    ort::init().commit().context("ort init")?;

    let mut tokenizer = Tokenizer::from_bytes(TOKENIZER)
        .map_err(|e| anyhow::anyhow!("tokenizer: {e}"))?;
    // Ensure padding so we can batch
    let pad = tokenizers::PaddingParams {
        strategy: tokenizers::PaddingStrategy::BatchLongest,
        direction: tokenizers::PaddingDirection::Right,
        pad_to_multiple_of: None,
        pad_id: 0,
        pad_type_id: 0,
        pad_token: "[PAD]".into(),
    };
    tokenizer.with_padding(Some(pad));

    let mut session = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(1)?
        .commit_from_memory(MODEL)?;

    let texts = &[
        "The quick brown fox jumps over the lazy dog.",
        "Hello, world!",
    ];
    let out = embed(&mut session, &tokenizer, texts)?;

    assert_eq!(out.len(), 2);
    for (i, v) in out.iter().enumerate() {
        assert_eq!(v.len(), 384, "expected 384-dim");
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "not unit-normalized: {norm}");
        println!(
            "text[{i}] dim={} norm={:.6} head=[{:.4}, {:.4}, {:.4}, {:.4}]",
            v.len(), norm, v[0], v[1], v[2], v[3]
        );
    }

    println!("Q2 PASS: ort + tokenizers produces 384-dim unit embeddings.");
    Ok(())
}
