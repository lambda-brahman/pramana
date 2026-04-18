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
    #[error("tenant: {0}")]
    Tenant(String),
}
