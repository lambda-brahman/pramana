use crate::data_source::DataSource;
use crate::error::TuiError;
use pramana_engine::{ArtifactView, BuildReport, SearchResult, TenantInfo};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};

pub enum IoResponse {
    HealthCheck(bool),
    Tenants(Result<Vec<TenantInfo>, TuiError>),
    Search {
        generation: u64,
        result: Result<Vec<SearchResult>, TuiError>,
    },
    Get {
        generation: u64,
        slug: String,
        result: Box<Result<Option<ArtifactView>, TuiError>>,
    },
    Reload {
        name: String,
        result: Result<BuildReport, TuiError>,
    },
    AddKb {
        name: String,
        result: Result<BuildReport, TuiError>,
    },
    RemoveKb {
        name: String,
        result: Result<(), TuiError>,
    },
    GraphData {
        generation: u64,
        slug: String,
        depth: usize,
        result: Box<Result<(ArtifactView, Vec<ArtifactView>), TuiError>>,
    },
}

pub struct IoHandle {
    data_source: Arc<Mutex<DataSource>>,
    pub(crate) tx: mpsc::Sender<IoResponse>,
}

fn acquire(ds: &Mutex<DataSource>) -> Result<MutexGuard<'_, DataSource>, TuiError> {
    ds.lock()
        .map_err(|_| TuiError::General("data source lock poisoned".into()))
}

impl IoHandle {
    pub fn new(data_source: DataSource) -> (Self, mpsc::Receiver<IoResponse>) {
        let (tx, rx) = mpsc::channel();
        let handle = Self {
            data_source: Arc::new(Mutex::new(data_source)),
            tx,
        };
        (handle, rx)
    }

    pub fn spawn_health_check(&self, port: u16) {
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = DataSource::check_daemon(port);
            let _ = tx.send(IoResponse::HealthCheck(result));
        });
    }

    pub fn spawn_list_tenants(&self) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(guard) => guard.list_tenants(),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::Tenants(result));
        });
    }

    pub fn spawn_search(&self, tenant: String, query: String, generation: u64) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(guard) => guard.search(&tenant, &query),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::Search { generation, result });
        });
    }

    pub fn spawn_get(&self, tenant: String, slug: String, generation: u64) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(guard) => guard.get(&tenant, &slug),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::Get {
                generation,
                slug,
                result: Box::new(result),
            });
        });
    }

    pub fn spawn_reload(&self, name: String) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(mut guard) => guard.reload(&name),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::Reload { name, result });
        });
    }

    pub fn spawn_add_kb(&self, name: String, source_dir: String) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(mut guard) => guard.add_kb(&name, &source_dir),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::AddKb { name, result });
        });
    }

    pub fn spawn_graph_traverse(
        &self,
        tenant: String,
        slug: String,
        depth: usize,
        generation: u64,
    ) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        let slug_clone = slug.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<(ArtifactView, Vec<ArtifactView>), TuiError> {
                let guard = acquire(&ds)?;
                let root = guard.get(&tenant, &slug_clone)?.ok_or_else(|| {
                    TuiError::General(format!("Artifact '{slug_clone}' not found"))
                })?;
                let traversed = guard.traverse(&tenant, &slug_clone, None, depth)?;
                Ok((root, traversed))
            })();
            let _ = tx.send(IoResponse::GraphData {
                generation,
                slug,
                depth,
                result: Box::new(result),
            });
        });
    }

    pub fn spawn_remove_kb(&self, name: String) {
        let ds = self.data_source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = match acquire(&ds) {
                Ok(mut guard) => guard.remove_kb(&name),
                Err(e) => Err(e),
            };
            let _ = tx.send(IoResponse::RemoveKb { name, result });
        });
    }
}
