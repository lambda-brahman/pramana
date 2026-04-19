use crate::builder::{BuildReport, Builder};
use crate::error::EngineError;
use crate::reader::Reader;
#[cfg(feature = "embeddings")]
use pramana_embedder::Embedder;
use pramana_storage::Storage;
use std::collections::HashMap;
use std::path::Path;
#[cfg(feature = "embeddings")]
use std::sync::Arc;

pub const RESERVED_NAMES: &[&str] = &[
    "get", "search", "traverse", "list", "tenants", "reload", "version",
];

#[derive(Debug, Clone)]
pub struct TenantConfig {
    pub name: String,
    pub source_dir: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantInfo {
    pub name: String,
    #[serde(default)]
    pub source_dir: String,
    pub artifact_count: usize,
}

struct TenantState {
    source_dir: String,
    storage: Storage,
    report: BuildReport,
}

pub struct PreparedTenant(TenantState);

impl std::fmt::Debug for PreparedTenant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedTenant")
            .field("source_dir", &self.0.source_dir)
            .finish_non_exhaustive()
    }
}

pub struct TenantManager {
    tenants: HashMap<String, TenantState>,
    #[cfg(feature = "embeddings")]
    embedder: Option<Arc<Embedder>>,
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: HashMap::new(),
            #[cfg(feature = "embeddings")]
            embedder: None,
        }
    }

    #[cfg(feature = "embeddings")]
    pub fn init_embedder(&mut self, model_id: &str) -> Result<(), EngineError> {
        let embedder = Embedder::load(model_id)?;
        self.embedder = Some(Arc::new(embedder));
        Ok(())
    }

    pub fn mount(&mut self, config: TenantConfig) -> Result<BuildReport, EngineError> {
        validate_tenant_name(&config.name)?;

        if self.tenants.contains_key(&config.name) {
            return Err(EngineError::TenantAlreadyExists(config.name));
        }

        let source_path = Path::new(&config.source_dir);
        if !source_path.is_dir() {
            return Err(EngineError::InvalidTenantName {
                name: config.name,
                reason: format!("source directory does not exist: {}", config.source_dir),
            });
        }

        let state = build_tenant_state(
            &config.source_dir,
            #[cfg(feature = "embeddings")]
            self.embedder.as_deref(),
        )?;
        let report = state.report.clone();
        self.tenants.insert(config.name, state);
        Ok(report)
    }

    pub fn tenant_source_dir(&self, name: &str) -> Result<String, EngineError> {
        self.tenants
            .get(name)
            .map(|s| s.source_dir.clone())
            .ok_or_else(|| EngineError::TenantNotFound(name.to_owned()))
    }

    #[cfg(feature = "embeddings")]
    pub fn embedder(&self) -> Option<Arc<Embedder>> {
        self.embedder.clone()
    }

    pub fn build_prepared(
        source_dir: &str,
        #[cfg(feature = "embeddings")] embedder: Option<&Embedder>,
    ) -> Result<PreparedTenant, EngineError> {
        if !Path::new(source_dir).is_dir() {
            return Err(EngineError::InvalidTenantName {
                name: String::new(),
                reason: format!("source directory no longer exists: {source_dir}"),
            });
        }
        let state = build_tenant_state(
            source_dir,
            #[cfg(feature = "embeddings")]
            embedder,
        )?;
        Ok(PreparedTenant(state))
    }

    pub fn prepare_reload(&self, name: &str) -> Result<PreparedTenant, EngineError> {
        let source_dir = self.tenant_source_dir(name)?;
        Self::build_prepared(
            &source_dir,
            #[cfg(feature = "embeddings")]
            self.embedder.as_deref(),
        )
    }

    pub fn apply_reload(
        &mut self,
        name: &str,
        prepared: PreparedTenant,
    ) -> Result<BuildReport, EngineError> {
        let old = self
            .tenants
            .remove(name)
            .ok_or_else(|| EngineError::TenantNotFound(name.to_owned()))?;
        let _ = old.storage.close();
        let report = prepared.0.report.clone();
        self.tenants.insert(name.to_owned(), prepared.0);
        Ok(report)
    }

    pub fn reload(&mut self, name: &str) -> Result<BuildReport, EngineError> {
        let prepared = self.prepare_reload(name)?;
        self.apply_reload(name, prepared)
    }

    pub fn reader(&self, name: &str) -> Result<Reader<'_>, EngineError> {
        let state = self
            .tenants
            .get(name)
            .ok_or_else(|| EngineError::TenantNotFound(name.to_owned()))?;
        Ok(Reader::new(&state.storage))
    }

    pub fn tenant_names(&self) -> Vec<String> {
        self.tenants.keys().cloned().collect()
    }

    pub fn list_tenants(&self) -> Vec<TenantInfo> {
        self.tenants
            .iter()
            .map(|(name, state)| {
                let artifact_count = state.storage.count_artifacts().unwrap_or(0);
                TenantInfo {
                    name: name.clone(),
                    source_dir: state.source_dir.clone(),
                    artifact_count,
                }
            })
            .collect()
    }

    pub fn unmount(&mut self, name: &str) -> Result<(), EngineError> {
        let state = self
            .tenants
            .remove(name)
            .ok_or_else(|| EngineError::TenantNotFound(name.to_owned()))?;
        let _ = state.storage.close();
        Ok(())
    }

    pub fn has_tenant(&self, name: &str) -> bool {
        self.tenants.contains_key(name)
    }

    pub fn close(self) {
        for (_, state) in self.tenants {
            let _ = state.storage.close();
        }
    }
}

fn build_tenant_state(
    source_dir: &str,
    #[cfg(feature = "embeddings")] embedder: Option<&Embedder>,
) -> Result<TenantState, EngineError> {
    let storage = Storage::open(":memory:")?;
    storage.initialize()?;

    let builder = Builder::new(&storage);
    let report = builder.ingest(Path::new(source_dir))?;

    #[cfg(feature = "embeddings")]
    if let Some(embedder) = embedder {
        build_embeddings(&storage, embedder)?;
    }

    Ok(TenantState {
        source_dir: source_dir.to_owned(),
        storage,
        report,
    })
}

#[cfg(feature = "embeddings")]
fn build_embeddings(storage: &Storage, embedder: &Embedder) -> Result<(), EngineError> {
    let artifacts = storage.list(None, None, None)?;
    if artifacts.is_empty() {
        return Ok(());
    }

    let texts: Vec<String> = artifacts
        .iter()
        .map(|artifact| {
            let mut text = artifact.title.clone();
            if let Some(ref summary) = artifact.summary {
                text.push(' ');
                text.push_str(summary);
            }
            text.push(' ');
            let content_prefix: String = artifact.content.chars().take(512).collect();
            text.push_str(&content_prefix);
            text
        })
        .collect();

    let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    let vectors = embedder.embed_batch(&text_refs)?;

    if vectors.len() != text_refs.len() {
        return Err(EngineError::Embed(pramana_embedder::EmbedError::Inference(
            format!(
                "embed count mismatch: expected {}, got {}",
                text_refs.len(),
                vectors.len()
            ),
        )));
    }

    for (i, vec) in vectors.into_iter().enumerate() {
        storage.insert_embedding(&artifacts[i].slug, &vec)?;
    }

    Ok(())
}

impl Default for TenantManager {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_tenant_name(name: &str) -> Result<(), EngineError> {
    if name.is_empty() {
        return Err(EngineError::InvalidTenantName {
            name: name.to_owned(),
            reason: "tenant name cannot be empty".into(),
        });
    }

    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(EngineError::InvalidTenantName {
            name: name.to_owned(),
            reason: "must start with a lowercase letter".into(),
        });
    }
    for ch in chars {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && ch != '-' {
            return Err(EngineError::InvalidTenantName {
                name: name.to_owned(),
                reason: format!("contains invalid character '{ch}'"),
            });
        }
    }

    if RESERVED_NAMES.contains(&name) {
        return Err(EngineError::InvalidTenantName {
            name: name.to_owned(),
            reason: "reserved name".into(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_tenant_names() {
        assert!(validate_tenant_name("abc").is_ok());
        assert!(validate_tenant_name("my-tenant").is_ok());
        assert!(validate_tenant_name("tenant1").is_ok());
        assert!(validate_tenant_name("a").is_ok());
    }

    #[test]
    fn invalid_tenant_names() {
        assert!(validate_tenant_name("").is_err());
        assert!(validate_tenant_name("1bad").is_err());
        assert!(validate_tenant_name("Bad").is_err());
        assert!(validate_tenant_name("has space").is_err());
        assert!(validate_tenant_name("has_underscore").is_err());
    }

    #[test]
    fn reserved_names_rejected() {
        for name in RESERVED_NAMES {
            assert!(validate_tenant_name(name).is_err());
        }
    }

    #[test]
    fn version_is_reserved() {
        // /v1/version is a top-level route; a tenant named "version" would shadow it
        assert!(validate_tenant_name("version").is_err());
    }

    #[test]
    fn structured_error_not_found() {
        let err = EngineError::TenantNotFound("test".into());
        assert_eq!(err.to_string(), "tenant 'test' not found");
    }

    #[test]
    fn structured_error_already_exists() {
        let err = EngineError::TenantAlreadyExists("test".into());
        assert_eq!(err.to_string(), "tenant 'test' already exists");
    }

    #[test]
    fn structured_error_invalid_name() {
        let err = EngineError::InvalidTenantName {
            name: "1bad".into(),
            reason: "must start with a lowercase letter".into(),
        };
        assert_eq!(
            err.to_string(),
            "invalid tenant name '1bad': must start with a lowercase letter"
        );
    }

    #[test]
    fn build_empty_source_produces_no_artifacts() {
        let dir = std::env::temp_dir().join("pramana-empty-build-test");
        std::fs::create_dir_all(&dir).unwrap();
        let state = build_tenant_state(
            dir.to_str().unwrap(),
            #[cfg(feature = "embeddings")]
            None,
        )
        .unwrap();
        assert_eq!(state.storage.count_artifacts().unwrap_or(0), 0);
        std::fs::remove_dir(&dir).ok();
    }
}
