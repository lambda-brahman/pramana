use crate::builder::{BuildReport, Builder};
use crate::error::EngineError;
use crate::reader::Reader;
use pramana_embedder::Embedder;
use pramana_storage::Storage;
use std::collections::HashMap;
use std::path::Path;

const RESERVED_NAMES: &[&str] = &[
    "get", "search", "traverse", "list", "tenants", "reload", "version",
];

#[derive(Debug, Clone)]
pub struct TenantConfig {
    pub name: String,
    pub source_dir: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantInfo {
    pub name: String,
    pub source_dir: String,
    pub artifact_count: usize,
}

struct TenantState {
    source_dir: String,
    storage: Storage,
    report: BuildReport,
}

pub struct TenantManager {
    tenants: HashMap<String, TenantState>,
    embedder: Option<Embedder>,
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: HashMap::new(),
            embedder: None,
        }
    }

    pub fn init_embedder(&mut self, model_id: &str) -> Result<(), EngineError> {
        let embedder = Embedder::load(model_id)?;
        self.embedder = Some(embedder);
        Ok(())
    }

    pub fn mount(&mut self, config: TenantConfig) -> Result<BuildReport, EngineError> {
        validate_tenant_name(&config.name)?;

        if self.tenants.contains_key(&config.name) {
            return Err(EngineError::Tenant(format!(
                "tenant '{}' already exists",
                config.name
            )));
        }

        let source_path = Path::new(&config.source_dir);
        if !source_path.is_dir() {
            return Err(EngineError::Tenant(format!(
                "source directory does not exist: {}",
                config.source_dir
            )));
        }

        let state = self.build_tenant(&config.source_dir)?;
        let report = state.report.clone();
        self.tenants.insert(config.name, state);
        Ok(report)
    }

    pub fn reload(&mut self, name: &str) -> Result<BuildReport, EngineError> {
        let source_dir = self
            .tenants
            .get(name)
            .map(|s| s.source_dir.clone())
            .ok_or_else(|| EngineError::Tenant(format!("tenant '{name}' not found")))?;

        let new_state = self.build_tenant(&source_dir)?;

        if let Some(old) = self.tenants.remove(name) {
            let _ = old.storage.close();
        }

        let report = new_state.report.clone();
        self.tenants.insert(name.to_owned(), new_state);
        Ok(report)
    }

    pub fn reader(&self, name: &str) -> Result<Reader<'_>, EngineError> {
        let state = self
            .tenants
            .get(name)
            .ok_or_else(|| EngineError::Tenant(format!("tenant '{name}' not found")))?;
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
            .ok_or_else(|| EngineError::Tenant(format!("tenant '{name}' not found")))?;
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

    fn build_tenant(&self, source_dir: &str) -> Result<TenantState, EngineError> {
        let storage = Storage::open(":memory:")?;
        storage.initialize()?;

        let builder = Builder::new(&storage);
        let report = builder.ingest(Path::new(source_dir))?;

        if let Some(ref embedder) = self.embedder {
            self.build_embeddings(&storage, embedder)?;
        }

        Ok(TenantState {
            source_dir: source_dir.to_owned(),
            storage,
            report,
        })
    }

    fn build_embeddings(&self, storage: &Storage, embedder: &Embedder) -> Result<(), EngineError> {
        let artifacts = storage.list(None)?;

        for artifact in &artifacts {
            let mut text = artifact.title.clone();
            if let Some(ref summary) = artifact.summary {
                text.push(' ');
                text.push_str(summary);
            }
            text.push(' ');
            let content_prefix: String = artifact.content.chars().take(512).collect();
            text.push_str(&content_prefix);

            let vectors = embedder.embed_batch(&[&text])?;
            if let Some(vec) = vectors.into_iter().next() {
                storage.insert_embedding(&artifact.slug, &vec)?;
            }
        }

        Ok(())
    }
}

impl Default for TenantManager {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_tenant_name(name: &str) -> Result<(), EngineError> {
    if name.is_empty() {
        return Err(EngineError::Tenant("tenant name cannot be empty".into()));
    }

    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(EngineError::Tenant(format!(
            "tenant name must start with a lowercase letter: '{name}'"
        )));
    }
    for ch in chars {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && ch != '-' {
            return Err(EngineError::Tenant(format!(
                "tenant name contains invalid character '{ch}': '{name}'"
            )));
        }
    }

    if RESERVED_NAMES.contains(&name) {
        return Err(EngineError::Tenant(format!("'{name}' is a reserved name")));
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
}
