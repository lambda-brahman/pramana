use crate::EmbedError;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn home_dir() -> Result<PathBuf, EmbedError> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| EmbedError::Download("HOME or USERPROFILE must be set".into()))
}

pub fn model_cache_dir(model_id: &str) -> Result<PathBuf, EmbedError> {
    Ok(home_dir()?
        .join(".cache")
        .join("pramana")
        .join("models")
        .join(model_id))
}

fn hf_url(model_id: &str, file: &str) -> String {
    format!("https://huggingface.co/{model_id}/resolve/main/{file}")
}

fn download_file(url: &str, dest: &Path) -> Result<(), EmbedError> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| EmbedError::Download(format!("mkdir {}: {e}", parent.display())))?;
    }
    let tmp = dest.with_extension("part");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(30))
        .build();
    let response = agent
        .get(url)
        .call()
        .map_err(|e| EmbedError::Download(format!("GET {url}: {e}")))?;
    let mut reader = response.into_reader();
    let mut file = fs::File::create(&tmp)
        .map_err(|e| EmbedError::Download(format!("create {}: {e}", tmp.display())))?;
    io::copy(&mut reader, &mut file)
        .map_err(|e| EmbedError::Download(format!("write {}: {e}", tmp.display())))?;
    fs::rename(&tmp, dest)
        .map_err(|e| EmbedError::Download(format!("rename to {}: {e}", dest.display())))?;
    Ok(())
}

pub fn ensure_model_files(
    cache_dir: &Path,
    model_id: &str,
    onnx_file: &str,
) -> Result<(), EmbedError> {
    let model_dest = cache_dir.join("model.onnx");
    let tokenizer_dest = cache_dir.join("tokenizer.json");

    download_file(&hf_url(model_id, onnx_file), &model_dest)?;
    download_file(&hf_url(model_id, "tokenizer.json"), &tokenizer_dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_dir_includes_model_id() {
        let dir = model_cache_dir("Xenova/gte-small").unwrap();
        assert!(dir.ends_with("pramana/models/Xenova/gte-small"));
    }

    #[test]
    fn hf_url_format() {
        let url = hf_url("Xenova/gte-small", "onnx/model.onnx");
        assert_eq!(
            url,
            "https://huggingface.co/Xenova/gte-small/resolve/main/onnx/model.onnx"
        );
    }

    #[test]
    fn hf_url_tokenizer() {
        let url = hf_url("Xenova/gte-small", "tokenizer.json");
        assert_eq!(
            url,
            "https://huggingface.co/Xenova/gte-small/resolve/main/tokenizer.json"
        );
    }
}
