const BGE_QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

struct ModelEntry {
    id: &'static str,
    dim: usize,
    max_length: usize,
    query_prefix: Option<&'static str>,
    onnx_file: &'static str,
    output_index: usize,
    pad_id: u32,
    pad_token: &'static str,
}

const REGISTRY: &[ModelEntry] = &[
    ModelEntry {
        id: "Xenova/gte-small",
        dim: 384,
        max_length: 512,
        query_prefix: None,
        onnx_file: "onnx/model.onnx",
        output_index: 0,
        pad_id: 0,
        pad_token: "[PAD]",
    },
    ModelEntry {
        id: "BAAI/bge-small-en-v1.5",
        dim: 384,
        max_length: 512,
        query_prefix: Some(BGE_QUERY_PREFIX),
        onnx_file: "onnx/model.onnx",
        output_index: 0,
        pad_id: 0,
        pad_token: "[PAD]",
    },
    ModelEntry {
        id: "BAAI/bge-base-en-v1.5",
        dim: 768,
        max_length: 512,
        query_prefix: Some(BGE_QUERY_PREFIX),
        onnx_file: "onnx/model.onnx",
        output_index: 0,
        pad_id: 0,
        pad_token: "[PAD]",
    },
    ModelEntry {
        id: "BAAI/bge-large-en-v1.5",
        dim: 1024,
        max_length: 512,
        query_prefix: Some(BGE_QUERY_PREFIX),
        onnx_file: "onnx/model.onnx",
        output_index: 0,
        pad_id: 0,
        pad_token: "[PAD]",
    },
];

#[derive(Debug)]
pub struct ModelConfig {
    pub model_id: String,
    pub dim: usize,
    pub max_length: usize,
    pub query_prefix: Option<&'static str>,
    pub onnx_file: &'static str,
    pub output_index: usize,
    pub pad_id: u32,
    pub pad_token: &'static str,
}

impl ModelConfig {
    pub fn for_model(model_id: &str) -> Result<Self, crate::EmbedError> {
        let entry = REGISTRY.iter().find(|e| e.id == model_id).ok_or_else(|| {
            crate::EmbedError::UnknownModel {
                model_id: model_id.to_string(),
                supported: Self::supported_models().join(", "),
            }
        })?;
        Ok(Self {
            model_id: model_id.to_string(),
            dim: entry.dim,
            max_length: entry.max_length,
            query_prefix: entry.query_prefix,
            onnx_file: entry.onnx_file,
            output_index: entry.output_index,
            pad_id: entry.pad_id,
            pad_token: entry.pad_token,
        })
    }

    pub fn supported_models() -> Vec<&'static str> {
        REGISTRY.iter().map(|e| e.id).collect()
    }

    pub fn apply_query_prefix<'a>(&self, text: &'a str, buf: &'a mut String) -> &'a str {
        match self.query_prefix {
            Some(prefix) => {
                buf.clear();
                buf.push_str(prefix);
                buf.push_str(text);
                buf.as_str()
            }
            None => text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gte_small_config() {
        let cfg = ModelConfig::for_model("Xenova/gte-small").unwrap();
        assert!(cfg.query_prefix.is_none());
        assert_eq!(cfg.dim, 384);
        assert_eq!(cfg.max_length, 512);
        assert_eq!(cfg.onnx_file, "onnx/model.onnx");
        assert_eq!(cfg.output_index, 0);
        assert_eq!(cfg.pad_id, 0);
        assert_eq!(cfg.pad_token, "[PAD]");
    }

    #[test]
    fn bge_small_config() {
        let cfg = ModelConfig::for_model("BAAI/bge-small-en-v1.5").unwrap();
        assert_eq!(cfg.dim, 384);
        assert!(cfg
            .query_prefix
            .unwrap()
            .contains("Represent this sentence"));
    }

    #[test]
    fn bge_base_has_768_dim() {
        let cfg = ModelConfig::for_model("BAAI/bge-base-en-v1.5").unwrap();
        assert_eq!(cfg.dim, 768);
        assert!(cfg.query_prefix.is_some());
    }

    #[test]
    fn bge_large_has_1024_dim() {
        let cfg = ModelConfig::for_model("BAAI/bge-large-en-v1.5").unwrap();
        assert_eq!(cfg.dim, 1024);
        assert!(cfg.query_prefix.is_some());
    }

    #[test]
    fn unknown_model_returns_error() {
        let result = ModelConfig::for_model("some-org/unknown-model");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("some-org/unknown-model"));
    }

    #[test]
    fn supported_models_includes_all_registry_entries() {
        let models = ModelConfig::supported_models();
        assert_eq!(models.len(), REGISTRY.len());
        assert!(models.contains(&"Xenova/gte-small"));
        assert!(models.contains(&"BAAI/bge-small-en-v1.5"));
        assert!(models.contains(&"BAAI/bge-base-en-v1.5"));
        assert!(models.contains(&"BAAI/bge-large-en-v1.5"));
    }

    #[test]
    fn apply_prefix_for_bge() {
        let cfg = ModelConfig::for_model("BAAI/bge-small-en-v1.5").unwrap();
        let mut buf = String::new();
        let result = cfg.apply_query_prefix("hello", &mut buf);
        assert!(result.starts_with("Represent this sentence"));
        assert!(result.ends_with("hello"));
    }

    #[test]
    fn apply_prefix_for_gte_is_passthrough() {
        let cfg = ModelConfig::for_model("Xenova/gte-small").unwrap();
        let mut buf = String::new();
        let result = cfg.apply_query_prefix("hello", &mut buf);
        assert_eq!(result, "hello");
    }
}
