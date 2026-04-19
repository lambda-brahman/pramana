use crate::data_source::DataSource;
use crate::error::TuiError;
use pramana_engine::{ArtifactView, BuildReport, SearchResult, TenantInfo};
use std::sync::atomic::{AtomicUsize, Ordering};
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

#[derive(Clone)]
enum IoSource {
    Standalone(Arc<Mutex<DataSource>>),
    Daemon { port: u16 },
}

fn acquire(ds: &Mutex<DataSource>) -> Result<MutexGuard<'_, DataSource>, TuiError> {
    ds.lock()
        .map_err(|_| TuiError::General("data source lock poisoned".into()))
}

impl IoSource {
    fn with<F, T>(&self, f: F) -> Result<T, TuiError>
    where
        F: FnOnce(&DataSource) -> Result<T, TuiError>,
    {
        match self {
            IoSource::Daemon { port } => f(&DataSource::Daemon { port: *port }),
            IoSource::Standalone(ds) => f(&*acquire(ds)?),
        }
    }

    fn with_mut<F, T>(&self, f: F) -> Result<T, TuiError>
    where
        F: FnOnce(&mut DataSource) -> Result<T, TuiError>,
    {
        match self {
            IoSource::Daemon { port } => f(&mut DataSource::Daemon { port: *port }),
            IoSource::Standalone(ds) => f(&mut *acquire(ds)?),
        }
    }
}

const MAX_IN_FLIGHT: usize = 8;

struct InFlightGuard(Arc<AtomicUsize>);

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

pub struct IoHandle {
    source: IoSource,
    pub(crate) tx: mpsc::Sender<IoResponse>,
    in_flight: Arc<AtomicUsize>,
}

impl IoHandle {
    pub fn new(data_source: DataSource) -> (Self, mpsc::Receiver<IoResponse>) {
        let (tx, rx) = mpsc::channel();
        let source = match data_source {
            ds @ DataSource::Standalone(_) => IoSource::Standalone(Arc::new(Mutex::new(ds))),
            DataSource::Daemon { port } => IoSource::Daemon { port },
        };
        let handle = Self {
            source,
            tx,
            in_flight: Arc::new(AtomicUsize::new(0)),
        };
        (handle, rx)
    }

    fn try_acquire_slot(&self) -> Option<InFlightGuard> {
        let counter = Arc::clone(&self.in_flight);
        let prev = counter.fetch_add(1, Ordering::Acquire);
        if prev >= MAX_IN_FLIGHT {
            counter.fetch_sub(1, Ordering::Release);
            return None;
        }
        Some(InFlightGuard(counter))
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
            let result = src.with(|ds| ds.list_tenants());
            let _ = tx.send(IoResponse::Tenants(result));
        });
    }

    pub fn spawn_search(&self, tenant: String, query: String, generation: u64) {
        let Some(slot) = self.try_acquire_slot() else {
            return;
        };
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.with(|ds| ds.search(&tenant, &query));
            let _ = tx.send(IoResponse::Search { generation, result });
            drop(slot);
        });
    }

    pub fn spawn_get(&self, tenant: String, slug: String, generation: u64) {
        let Some(slot) = self.try_acquire_slot() else {
            return;
        };
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.with(|ds| ds.get(&tenant, &slug));
            let _ = tx.send(IoResponse::Get {
                generation,
                slug,
                result: Box::new(result),
            });
            drop(slot);
        });
    }

    pub fn spawn_reload(&self, name: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.with_mut(|ds| ds.reload(&name));
            let _ = tx.send(IoResponse::Reload { name, result });
        });
    }

    pub fn spawn_add_kb(&self, name: String, source_dir: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.with_mut(|ds| ds.add_kb(&name, &source_dir));
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
        let Some(slot) = self.try_acquire_slot() else {
            return;
        };
        let src = self.source.clone();
        let tx = self.tx.clone();
        let slug_clone = slug.clone();
        std::thread::spawn(move || {
            let result = src.with(|ds| {
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
            drop(slot);
        });
    }

    pub fn spawn_remove_kb(&self, name: String) {
        let src = self.source.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = src.with_mut(|ds| ds.remove_kb(&name));
            let _ = tx.send(IoResponse::RemoveKb { name, result });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn try_acquire_slot_caps_at_max_in_flight() {
        let (handle, _rx) = IoHandle::new(DataSource::Daemon { port: 9999 });
        let mut guards = Vec::new();
        for _ in 0..MAX_IN_FLIGHT {
            guards.push(handle.try_acquire_slot().expect("should acquire slot"));
        }
        assert!(handle.try_acquire_slot().is_none());
        assert_eq!(handle.in_flight.load(Ordering::Relaxed), MAX_IN_FLIGHT);

        drop(guards);
        assert_eq!(handle.in_flight.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn daemon_with_allows_concurrent_access() {
        use std::sync::Barrier;

        let src = IoSource::Daemon { port: 0 };
        let n = 4;
        let barrier = Arc::new(Barrier::new(n));
        let mut handles = Vec::new();

        for _ in 0..n {
            let s = src.clone();
            let b = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                // If `with` serialized through a mutex, only one thread could
                // enter at a time and the barrier (needing all 4) would deadlock.
                s.with(|_ds| {
                    b.wait();
                    Ok(())
                })
            }));
        }

        for h in handles {
            h.join().unwrap().unwrap();
        }
    }
}
