use crate::config::Settings;
use crate::providers::ModelInfo;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

const MODEL_CACHE_TTL_SECS: u64 = 300;

pub struct ModelCacheEntry {
    pub fetched_at: Instant,
    pub models: Vec<ModelInfo>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub settings: Mutex<Settings>,
    pub active_streams: Mutex<HashMap<String, CancellationToken>>,
    pub model_cache: Mutex<HashMap<String, ModelCacheEntry>>,
    /// Problems hit during startup that were recovered from (settings reset to
    /// defaults, history running memory-only). Surfaced to the user via
    /// `get_diagnostics` so a degraded launch isn't silent.
    pub startup_warnings: Vec<String>,
    /// Shared across every provider instance. Building a fresh
    /// `reqwest::Client` per request (the old behavior) re-parses the root
    /// cert store and does a full TLS handshake on every message sent - this
    /// keeps one connection pool and one set of timeouts for the app's
    /// lifetime.
    pub http: reqwest::Client,
    /// One persistent session per configured MCP server, spawned on first
    /// use. Not behind a `Mutex` itself - its internals already synchronize,
    /// and `AppState` is always accessed through a shared reference.
    pub mcp: crate::mcp::McpManager,
}

impl AppState {
    pub fn model_cache_ttl() -> std::time::Duration {
        std::time::Duration::from_secs(MODEL_CACHE_TTL_SECS)
    }
}

/// Lock accessors that recover from poisoning instead of propagating it.
///
/// A panic while one of these is held poisons the mutex, and every later
/// `.lock().unwrap()` would then panic too - which under `panic = "abort"`
/// killed the process outright. The guarded values (a sqlite handle, a settings
/// struct, two maps) are not left in a torn state by an unrelated panic, so
/// taking the data back is strictly better than cascading.
impl AppState {
    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn settings(&self) -> MutexGuard<'_, Settings> {
        self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn active_streams(&self) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.active_streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    pub fn model_cache(&self) -> MutexGuard<'_, HashMap<String, ModelCacheEntry>> {
        self.model_cache.lock().unwrap_or_else(|e| e.into_inner())
    }
}
