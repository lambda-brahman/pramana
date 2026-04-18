#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("{0}")]
    User(String),
    #[error("engine: {0}")]
    Engine(#[from] pramana_engine::EngineError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}
