use crate::convert::artifact_to_storage;
use crate::error::EngineError;
use pramana_storage::Storage;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct BuildReport {
    pub total: usize,
    pub succeeded: usize,
    pub failed: Vec<BuildFailure>,
}

#[derive(Debug, Clone)]
pub struct BuildFailure {
    pub file: String,
    pub error: String,
}

pub struct Builder<'a> {
    storage: &'a Storage,
}

impl<'a> Builder<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn ingest(&self, source_dir: &Path) -> Result<BuildReport, EngineError> {
        let mut total = 0;
        let mut succeeded = 0;
        let mut failed = Vec::new();

        for entry in WalkDir::new(source_dir)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let path_str = path.to_string_lossy();
            if path_str.contains("_meta/") || path_str.contains("_meta\\") {
                continue;
            }

            total += 1;

            match pramana_parser::parse_document_from_file(path) {
                Ok(artifact) => {
                    let storage_artifact = artifact_to_storage(&artifact);
                    match self.storage.insert_artifact(&storage_artifact) {
                        Ok(()) => succeeded += 1,
                        Err(e) => failed.push(BuildFailure {
                            file: path_str.into_owned(),
                            error: e.to_string(),
                        }),
                    }
                }
                Err(e) => {
                    failed.push(BuildFailure {
                        file: path_str.into_owned(),
                        error: e.to_string(),
                    });
                }
            }
        }

        Ok(BuildReport {
            total,
            succeeded,
            failed,
        })
    }
}
