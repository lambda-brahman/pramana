//! SQLite-backed knowledge artifact storage with FTS5 full-text search
//! and sqlite-vec vector similarity search.
//!
//! # Connection discipline
//!
//! SQLite enforces single-writer semantics. With WAL mode (set during
//! [`Storage::initialize`]), concurrent reads are allowed but writes
//! serialize through a single connection. Callers needing concurrent
//! access should use one [`Storage`] instance for writes and may open
//! additional read-only connections separately.
//!
//! [`Storage`] wraps a single [`rusqlite::Connection`] and is not
//! `Sync`. For multi-threaded access, wrap in a `Mutex` or use a
//! connection pool with at most one writer.

mod error;
mod fts;
mod model;
mod rrf;
mod schema;
mod store;

pub use error::{StorageError, StorageResult};
pub use fts::{NoOpFilter, StopWordFilter};
pub use model::{Artifact, RankedResult, Relationship, SearchResult, Section};
pub use rrf::rrf;
pub use store::Storage;
