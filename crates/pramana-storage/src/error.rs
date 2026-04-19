use std::fmt;

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    InvalidDimension { expected: usize, got: usize },
    NonFiniteEmbedding,
    WalModeUnavailable,
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Sqlite(e) => write!(f, "SQLite error: {e}"),
            StorageError::Json(e) => write!(f, "JSON error: {e}"),
            StorageError::InvalidDimension { expected, got } => {
                write!(
                    f,
                    "invalid embedding dimension: expected {expected}, got {got}"
                )
            }
            StorageError::NonFiniteEmbedding => {
                write!(f, "embedding contains NaN or infinite values")
            }
            StorageError::WalModeUnavailable => {
                write!(f, "WAL journal mode could not be enabled for this database")
            }
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StorageError::Sqlite(e) => Some(e),
            StorageError::Json(e) => Some(e),
            StorageError::InvalidDimension { .. } => None,
            StorageError::NonFiniteEmbedding => None,
            StorageError::WalModeUnavailable => None,
        }
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(e: rusqlite::Error) -> Self {
        StorageError::Sqlite(e)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(e: serde_json::Error) -> Self {
        StorageError::Json(e)
    }
}

pub type StorageResult<T> = Result<T, StorageError>;
