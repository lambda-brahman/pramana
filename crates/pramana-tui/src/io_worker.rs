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

enum IoSource {
    Standalone(Arc<Mutex<DataSource>>),
    Daemon { port: u16 },
}

impl Clone for IoSource {
    fn clone(&self) -> Self {
        match self {
            IoSource::Standalone(ds) => IoSource::Standalone(ds.clone()),
            IoSource::Daemon { port } => IoSource::Daemon { port: *port },
        }
    }
}

fn acquire(ds: &Mutex<DataSource>) -> Result<MutexGuard<'_, DataSource>, TuiError> {
    ds.lock()
        .map_err(|_| TuiError::General("data source lock poisoned".into()))
}

impl IoSource {
    fn read<F, T>(&self, f: F) -> Result<T, TuiError>
    where
        F: FnOnce(&DataSource) -> Result<T, TuiError>,
    {
        match self {
            IoSource::Daemon { port } => f(&DataSource::Daemon { port: *port }),
            IoSource::Standalone(ds) => f(&*acquire(ds)?),
        }
    }

    fn write<F, T>(&self, f: F) -> Result<T, TuiError>
    where
        F: FnOnce(&mut DataSource) -> Result<T, TuiError>,
    {
        match self {
            IoSource::Daemon { port } => f(&mut DataSource::Daemon { port: *port }),
            IoSource::Standalone(ds) => f(&mut *acquire(ds)?),
        }
    }
}

pub struct IoHandle {
    source: IoSource,
    pub(crate) tx: mpsc::Sender<IoResponse>,
}

impl IoHandle {
    pub fn new(data_source: DataSource) -> (Self, mpsc::Receiver<IoResponse>) {
        let (tx, rx) = mpsc::channel();
        let source = match data_source {
            ds @ DataSource::Standalone(_) => IoSource::Standalone(Arc::new(Mutex::new(ds))),
            DataSource::Daemon { port } => IoSource::Daemon { port },
        };
        let handle = Self { source, tx };
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
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.read(|ds| ds.list_tenants());
            let _ = tx.send(IoResponse::Tenants(result));
        });
    }

    pub fn spawn_search(&self, tenant: String, query: String, generation: u64) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.read(|ds| ds.search(&tenant, &query));
            let _ = tx.send(IoResponse::Search { generation, result });
        });
    }

    pub fn spawn_get(&self, tenant: String, slug: String, generation: u64) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.read(|ds| ds.get(&tenant, &slug));
            let _ = tx.send(IoResponse::Get {
                generation,
                slug,
                result: Box::new(result),
            });
        });
    }

    pub fn spawn_reload(&self, name: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.write(|ds| ds.reload(&name));
            let _ = tx.send(IoResponse::Reload { name, result });
        });
    }

    pub fn spawn_add_kb(&self, name: String, source_dir: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.write(|ds| ds.add_kb(&name, &source_dir));
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
        let src = self.source.clone();
        let tx = self.tx.clone();
        let slug_clone = slug.clone();
        std::thread::spawn(move || {
            let result = src.read(|ds| {
                let root = ds.get(&tenant, &slug_clone)?.ok_or_else(|| {
                    TuiError::General(format!("Artifact '{slug_clone}' not found"))
                })?;
                let traversed = ds.traverse(&tenant, &slug_clone, None, depth)?;
                Ok((root, traversed))
            });
            let _ = tx.send(IoResponse::GraphData {
                generation,
                slug,
                depth,
                result: Box::new(result),
            });
        });
    }

    pub fn spawn_remove_kb(&self, name: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.write(|ds| ds.remove_kb(&name));
            let _ = tx.send(IoResponse::RemoveKb { name, result });
        });
    }
}
