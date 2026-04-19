use crate::EmbedError;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

const ONNX_MIN_SIZE: u64 = 1024;

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

fn validate_onnx(path: &Path) -> Result<(), EmbedError> {
    let bytes = fs::read(path)
        .map_err(|e| EmbedError::Download(format!("read {}: {e}", path.display())))?;
    if bytes.first() == Some(&b'<') {
        return Err(EmbedError::Download(format!(
            "{}: looks like HTML, not ONNX (gated/auth-required model?)",
            path.display()
        )));
    }
    if (bytes.len() as u64) < ONNX_MIN_SIZE {
        return Err(EmbedError::Download(format!(
            "{}: too small ({} bytes), expected ONNX model",
            path.display(),
            bytes.len()
        )));
    }
    Ok(())
}

fn validate_tokenizer_json(path: &Path) -> Result<(), EmbedError> {
    let bytes = fs::read(path)
        .map_err(|e| EmbedError::Download(format!("read {}: {e}", path.display())))?;
    if bytes.first() == Some(&b'<') {
        return Err(EmbedError::Download(format!(
            "{}: looks like HTML, not JSON (gated/auth-required model?)",
            path.display()
        )));
    }
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|e| EmbedError::Download(format!("{}: invalid JSON: {e}", path.display())))?;
    Ok(())
}

fn download_and_validate(
    url: &str,
    dest: &Path,
    validate: fn(&Path) -> Result<(), EmbedError>,
) -> Result<(), EmbedError> {
    if dest.exists() {
        if validate(dest).is_ok() {
            return Ok(());
        }
        let _ = fs::remove_file(dest);
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| EmbedError::Download(format!("mkdir {}: {e}", parent.display())))?;
    }

    let tmp = dest.with_extension(format!("{}.part", std::process::id()));
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

    if let Err(e) = validate(&tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

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

    download_and_validate(&hf_url(model_id, onnx_file), &model_dest, validate_onnx)?;
    download_and_validate(
        &hf_url(model_id, "tokenizer.json"),
        &tokenizer_dest,
        validate_tokenizer_json,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

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

    #[test]
    fn validate_onnx_rejects_html() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.onnx");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(b"<!DOCTYPE html><html><body>Error</body></html>")
            .unwrap();
        let err = validate_onnx(&path).unwrap_err();
        assert!(err.to_string().contains("HTML"));
    }

    #[test]
    fn validate_onnx_rejects_tiny_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.onnx");
        fs::write(&path, b"tiny").unwrap();
        let err = validate_onnx(&path).unwrap_err();
        assert!(err.to_string().contains("too small"));
    }

    #[test]
    fn validate_onnx_accepts_valid_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.onnx");
        let data = vec![0x08u8; 2048];
        fs::write(&path, &data).unwrap();
        assert!(validate_onnx(&path).is_ok());
    }

    #[test]
    fn validate_tokenizer_rejects_html() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokenizer.json");
        fs::write(&path, b"<html>Not Found</html>").unwrap();
        let err = validate_tokenizer_json(&path).unwrap_err();
        assert!(err.to_string().contains("HTML"));
    }

    #[test]
    fn validate_tokenizer_rejects_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokenizer.json");
        fs::write(&path, b"not json at all").unwrap();
        let err = validate_tokenizer_json(&path).unwrap_err();
        assert!(err.to_string().contains("invalid JSON"));
    }

    #[test]
    fn validate_tokenizer_accepts_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokenizer.json");
        fs::write(&path, b"{\"version\": \"1.0\"}").unwrap();
        assert!(validate_tokenizer_json(&path).is_ok());
    }
}
