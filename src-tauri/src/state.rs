use crate::config::Settings;
use crate::providers::ModelInfo;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
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
}

impl AppState {
    pub fn model_cache_ttl() -> std::time::Duration {
        std::time::Duration::from_secs(MODEL_CACHE_TTL_SECS)
    }
}
