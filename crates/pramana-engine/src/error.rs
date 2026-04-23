#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("parse: {0}")]
    Parse(#[from] pramana_parser::ParseError),
    #[error("storage: {0}")]
    Storage(#[from] pramana_storage::StorageError),
    #[cfg(feature = "embeddings")]
    #[error("embed: {0}")]
    Embed(#[from] pramana_embedder::EmbedError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("tenant '{0}' not found")]
    TenantNotFound(String),
    #[error("tenant '{0}' already exists")]
    TenantAlreadyExists(String),
    #[error("invalid tenant name '{name}': {reason}")]
    InvalidTenantName { name: String, reason: String },
    #[error("source_dir \"{0}\" does not exist")]
    SourceDirNotFound(String),
}
