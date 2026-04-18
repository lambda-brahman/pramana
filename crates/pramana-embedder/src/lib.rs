mod download;
mod model;

pub use model::ModelConfig;

use ndarray::{Array, Array2};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;
use std::sync::Mutex;
use tokenizers::{
    PaddingDirection, PaddingParams, PaddingStrategy, Tokenizer, TruncationDirection,
    TruncationParams, TruncationStrategy,
};

pub const DEFAULT_MODEL: &str = "Xenova/gte-small";

#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    #[error("model download failed: {0}")]
    Download(String),
    #[error("tokenizer error: {0}")]
    Tokenizer(String),
    #[error("session error: {0}")]
    Session(String),
    #[error("inference error: {0}")]
    Inference(String),
}

pub struct Embedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    config: ModelConfig,
}

impl Embedder {
    pub fn load(model_id: &str) -> Result<Self, EmbedError> {
        let config = ModelConfig::for_model(model_id);
        let cache_dir = download::model_cache_dir(model_id)?;
        download::ensure_model_files(&cache_dir, model_id, config.onnx_file)?;

        let tokenizer = load_tokenizer(&cache_dir, &config)?;
        let session = load_session(&cache_dir)?;

        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
            config,
        })
    }

    pub fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut session = self
            .session
            .lock()
            .map_err(|e| EmbedError::Inference(format!("session lock: {e}")))?;
        run_inference(&mut session, &self.tokenizer, texts, self.config.dim)
    }

    pub fn embed_query(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let mut buf = String::new();
        let input = self.config.apply_query_prefix(text, &mut buf);
        let mut results = self.embed_batch(&[input])?;
        Ok(results.remove(0))
    }

    pub fn model_id(&self) -> &str {
        &self.config.model_id
    }

    pub fn dim(&self) -> usize {
        self.config.dim
    }
}

fn load_tokenizer(cache_dir: &Path, config: &ModelConfig) -> Result<Tokenizer, EmbedError> {
    let path = cache_dir.join("tokenizer.json");
    let mut tokenizer = Tokenizer::from_file(&path)
        .map_err(|e| EmbedError::Tokenizer(format!("load {}: {e}", path.display())))?;

    // Override truncation to model_max_length (512) — tokenizer.json embeds 128
    // which over-truncates documents. See spike #104 findings.
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: config.max_length,
            strategy: TruncationStrategy::LongestFirst,
            stride: 0,
            direction: TruncationDirection::Right,
        }))
        .map_err(|e| EmbedError::Tokenizer(format!("truncation config: {e}")))?;

    tokenizer.with_padding(Some(PaddingParams {
        strategy: PaddingStrategy::BatchLongest,
        direction: PaddingDirection::Right,
        pad_to_multiple_of: None,
        pad_id: 0,
        pad_type_id: 0,
        pad_token: "[PAD]".into(),
    }));

    Ok(tokenizer)
}

fn load_session(cache_dir: &Path) -> Result<Session, EmbedError> {
    let model_path = cache_dir.join("model.onnx");
    Session::builder()
        .map_err(|e| EmbedError::Session(format!("builder: {e}")))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| EmbedError::Session(format!("optimization: {e}")))?
        .with_intra_threads(1)
        .map_err(|e| EmbedError::Session(format!("threads: {e}")))?
        .commit_from_file(&model_path)
        .map_err(|e| EmbedError::Session(format!("load {}: {e}", model_path.display())))
}

fn run_inference(
    session: &mut Session,
    tokenizer: &Tokenizer,
    texts: &[&str],
    expected_dim: usize,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    let encodings = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| EmbedError::Inference(format!("encode_batch: {e}")))?;

    let batch = texts.len();
    let max_len = encodings.iter().map(|e| e.len()).max().unwrap_or(0);

    let mut ids = Array2::<i64>::zeros((batch, max_len));
    let mut mask = Array2::<i64>::zeros((batch, max_len));
    let mut type_ids = Array2::<i64>::zeros((batch, max_len));

    for (i, enc) in encodings.iter().enumerate() {
        for (j, &id) in enc.get_ids().iter().enumerate() {
            ids[[i, j]] = id as i64;
        }
        for (j, &m) in enc.get_attention_mask().iter().enumerate() {
            mask[[i, j]] = m as i64;
        }
        for (j, &t) in enc.get_type_ids().iter().enumerate() {
            type_ids[[i, j]] = t as i64;
        }
    }

    let input_ids = Tensor::from_array(ids)
        .map_err(|e| EmbedError::Inference(format!("input_ids tensor: {e}")))?;
    let attention_mask = Tensor::from_array(mask.clone())
        .map_err(|e| EmbedError::Inference(format!("attention_mask tensor: {e}")))?;
    let token_type_ids = Tensor::from_array(type_ids)
        .map_err(|e| EmbedError::Inference(format!("token_type_ids tensor: {e}")))?;

    let outputs = session
        .run(ort::inputs![input_ids, attention_mask, token_type_ids])
        .map_err(|e| EmbedError::Inference(format!("session.run: {e}")))?;

    let (shape, raw) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| EmbedError::Inference(format!("extract tensor: {e}")))?;

    if shape.len() < 3 {
        return Err(EmbedError::Inference(format!(
            "expected 3-D output, got {}-D",
            shape.len()
        )));
    }
    let hidden = shape[2] as usize;
    let seq = shape[1] as usize;

    if hidden != expected_dim {
        return Err(EmbedError::Inference(format!(
            "expected {expected_dim}-dim, got {hidden}-dim"
        )));
    }

    let hidden_states = Array::from_shape_vec((batch, seq, hidden), raw.to_vec())
        .map_err(|e| EmbedError::Inference(format!("reshape: {e}")))?;
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

fn l2_normalize(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
    for x in v.iter_mut() {
        *x /= norm;
    }
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l2_normalize_unit_vector() {
        let mut v = vec![1.0, 0.0, 0.0];
        l2_normalize(&mut v);
        assert!((v[0] - 1.0).abs() < 1e-6);
        assert!(v[1].abs() < 1e-6);
        assert!(v[2].abs() < 1e-6);
    }

    #[test]
    fn l2_normalize_arbitrary_vector() {
        let mut v = vec![3.0, 4.0];
        l2_normalize(&mut v);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert!((v[0] - 0.6).abs() < 1e-5);
        assert!((v[1] - 0.8).abs() < 1e-5);
    }

    #[test]
    fn l2_normalize_zero_vector_uses_epsilon() {
        let mut v = vec![0.0, 0.0, 0.0];
        l2_normalize(&mut v);
        assert!(v.iter().all(|x| x.is_finite()));
    }

    #[test]
    fn cosine_similarity_identical() {
        let a = vec![0.6, 0.8];
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn default_model_constant() {
        assert_eq!(DEFAULT_MODEL, "Xenova/gte-small");
    }
}
