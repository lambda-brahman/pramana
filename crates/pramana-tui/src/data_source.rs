use crate::error::TuiError;
use pramana_engine::{
    ArtifactView, BuildReport, ListFilter, SearchResult, TenantConfig, TenantInfo, TenantManager,
};

pub enum DataSource {
    Standalone(Box<TenantManager>),
    Daemon { port: u16 },
}

impl DataSource {
    pub fn mode_label(&self) -> &str {
        match self {
            DataSource::Standalone(_) => "standalone",
            DataSource::Daemon { .. } => "daemon",
        }
    }

    pub fn list_tenants(&self) -> Result<Vec<TenantInfo>, TuiError> {
        match self {
            DataSource::Standalone(tm) => Ok(tm.list_tenants()),
            DataSource::Daemon { port } => {
                let url = format!("http://localhost:{port}/v1/tenants");
                let body = daemon_get(&url)?;
                let tenants: Vec<TenantInfo> =
                    serde_json::from_str(&body).map_err(|e| TuiError::Http(e.to_string()))?;
                Ok(tenants)
            }
        }
    }

    pub fn list(
        &self,
        tenant: &str,
        filter: Option<&ListFilter>,
    ) -> Result<Vec<ArtifactView>, TuiError> {
        match self {
            DataSource::Standalone(tm) => {
                let reader = tm.reader(tenant)?;
                Ok(reader.list(filter)?)
            }
            DataSource::Daemon { port } => {
                let url = match filter.and_then(|f| f.tags.as_ref()) {
                    Some(tags) => format!(
                        "http://localhost:{port}/v1/{tenant}/list?tags={}",
                        tags.join(",")
                    ),
                    None => format!("http://localhost:{port}/v1/{tenant}/list"),
                };
                let body = daemon_get(&url)?;
                let artifacts: Vec<ArtifactView> =
                    serde_json::from_str(&body).map_err(|e| TuiError::Http(e.to_string()))?;
                Ok(artifacts)
            }
        }
    }

    pub fn get(&self, tenant: &str, slug: &str) -> Result<Option<ArtifactView>, TuiError> {
        match self {
            DataSource::Standalone(tm) => {
                let reader = tm.reader(tenant)?;
                Ok(reader.get(slug)?)
            }
            DataSource::Daemon { port } => {
                let url = format!("http://localhost:{port}/v1/{tenant}/get/{slug}");
                match daemon_get(&url) {
                    Ok(body) => {
                        let artifact: ArtifactView = serde_json::from_str(&body)
                            .map_err(|e| TuiError::Http(e.to_string()))?;
                        Ok(Some(artifact))
                    }
                    Err(_) => Ok(None),
                }
            }
        }
    }

    pub fn search(&self, tenant: &str, query: &str) -> Result<Vec<SearchResult>, TuiError> {
        match self {
            DataSource::Standalone(tm) => {
                let reader = tm.reader(tenant)?;
                Ok(reader.search(query, None)?)
            }
            DataSource::Daemon { port } => {
                let encoded = urlencoded(query);
                let url = format!("http://localhost:{port}/v1/{tenant}/search?q={encoded}");
                let body = daemon_get(&url)?;
                let results: Vec<SearchResult> =
                    serde_json::from_str(&body).map_err(|e| TuiError::Http(e.to_string()))?;
                Ok(results)
            }
        }
    }

    pub fn reload(&mut self, tenant: &str) -> Result<BuildReport, TuiError> {
        match self {
            DataSource::Standalone(tm) => Ok(tm.reload(tenant)?),
            DataSource::Daemon { port } => {
                let url = format!("http://localhost:{}/v1/{tenant}/reload", port);
                let body = daemon_post(&url)?;
                let report: BuildReport =
                    serde_json::from_str(&body).map_err(|e| TuiError::Http(e.to_string()))?;
                Ok(report)
            }
        }
    }

    pub fn add_kb(&mut self, name: &str, source_dir: &str) -> Result<BuildReport, TuiError> {
        match self {
            DataSource::Standalone(tm) => {
                let cfg = TenantConfig {
                    name: name.to_owned(),
                    source_dir: source_dir.to_owned(),
                };
                Ok(tm.mount(cfg)?)
            }
            DataSource::Daemon { .. } => Err(TuiError::General(
                "add-kb not supported in daemon mode (restart daemon to apply)".into(),
            )),
        }
    }

    pub fn remove_kb(&mut self, name: &str) -> Result<(), TuiError> {
        match self {
            DataSource::Standalone(tm) => Ok(tm.unmount(name)?),
            DataSource::Daemon { .. } => Err(TuiError::General(
                "remove-kb not supported in daemon mode (restart daemon to apply)".into(),
            )),
        }
    }

    pub fn check_daemon(port: u16) -> bool {
        ureq::get(&format!("http://localhost:{port}/v1/version"))
            .timeout(std::time::Duration::from_secs(1))
            .call()
            .is_ok()
    }
}

fn daemon_get(url: &str) -> Result<String, TuiError> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| TuiError::Http(e.to_string()))?;
    resp.into_string()
        .map_err(|e| TuiError::Http(e.to_string()))
}

fn daemon_post(url: &str) -> Result<String, TuiError> {
    let resp = ureq::post(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| TuiError::Http(e.to_string()))?;
    resp.into_string()
        .map_err(|e| TuiError::Http(e.to_string()))
}

fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push('%');
                result.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                result.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    result
}
