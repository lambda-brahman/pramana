use crate::convert::artifact_to_storage;
use crate::error::EngineError;
use pramana_storage::Storage;
use std::collections::HashSet;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
#[must_use]
pub struct BuildReport {
    pub total: usize,
    pub succeeded: usize,
    pub failed: Vec<BuildFailure>,
    pub walk_errors: Vec<String>,
    pub duplicate_slugs: Vec<String>,
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
        let mut walk_errors = Vec::new();
        let mut seen_slugs = HashSet::new();
        let mut duplicate_slugs = Vec::new();

        for result in WalkDir::new(source_dir).follow_links(true) {
            let entry = match result {
                Ok(e) => e,
                Err(e) => {
                    walk_errors.push(e.to_string());
                    continue;
                }
            };

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
                    if !seen_slugs.insert(artifact.slug.clone()) {
                        duplicate_slugs.push(artifact.slug.clone());
                    }
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
            walk_errors,
            duplicate_slugs,
        })
    }
}
