const BGE_QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

pub struct ModelConfig {
    pub model_id: String,
    pub dim: usize,
    pub max_length: usize,
    pub query_prefix: Option<&'static str>,
    pub onnx_file: &'static str,
    /// Index of the hidden-states tensor in the ONNX session outputs array.
    /// gte-small exports hidden states at index 0; other models may differ.
    pub output_index: usize,
    /// Padding token id used when batching sequences to equal length.
    /// gte-small uses 0; other tokenizers may use a different value.
    pub pad_id: u32,
    /// Padding token string matching pad_id in the tokenizer vocabulary.
    pub pad_token: &'static str,
}

impl ModelConfig {
    pub fn for_model(model_id: &str) -> Self {
        let is_bge = model_id.to_lowercase().contains("bge");
        Self {
            model_id: model_id.to_string(),
            dim: 384,
            max_length: 512,
            query_prefix: if is_bge { Some(BGE_QUERY_PREFIX) } else { None },
            onnx_file: "onnx/model.onnx",
            output_index: 0,
            pad_id: 0,
            pad_token: "[PAD]",
        }
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
    fn gte_model_has_no_prefix() {
        let cfg = ModelConfig::for_model("Xenova/gte-small");
        assert!(cfg.query_prefix.is_none());
        assert_eq!(cfg.dim, 384);
        assert_eq!(cfg.max_length, 512);
        assert_eq!(cfg.onnx_file, "onnx/model.onnx");
        assert_eq!(cfg.output_index, 0);
        assert_eq!(cfg.pad_id, 0);
        assert_eq!(cfg.pad_token, "[PAD]");
    }

    #[test]
    fn bge_model_has_prefix() {
        let cfg = ModelConfig::for_model("BAAI/bge-small-en-v1.5");
        assert!(cfg.query_prefix.is_some());
        assert!(cfg
            .query_prefix
            .unwrap()
            .contains("Represent this sentence"));
    }

    #[test]
    fn bge_detection_is_case_insensitive() {
        let cfg = ModelConfig::for_model("some-org/BGE-large-v2");
        assert!(cfg.query_prefix.is_some());
    }

    #[test]
    fn apply_prefix_for_bge() {
        let cfg = ModelConfig::for_model("BAAI/bge-small-en-v1.5");
        let mut buf = String::new();
        let result = cfg.apply_query_prefix("hello", &mut buf);
        assert!(result.starts_with("Represent this sentence"));
        assert!(result.ends_with("hello"));
    }

    #[test]
    fn apply_prefix_for_gte_is_passthrough() {
        let cfg = ModelConfig::for_model("Xenova/gte-small");
        let mut buf = String::new();
        let result = cfg.apply_query_prefix("hello", &mut buf);
        assert_eq!(result, "hello");
    }
}
