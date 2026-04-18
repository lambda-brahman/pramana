#[derive(Debug, thiserror::Error)]
pub enum TuiError {
    #[error("engine: {0}")]
    Engine(#[from] pramana_engine::EngineError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(String),
    #[error("tui: {0}")]
    General(String),
}
