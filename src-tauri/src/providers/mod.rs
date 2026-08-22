pub mod anthropic;
pub mod gemini;
pub mod ollama;
pub mod openai;
pub mod openai_compat;

use crate::config::{Dialect, ProviderConfig};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Default)]
pub struct Usage {
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
}

/// What a provider can put on the internal mpsc channel while streaming.
/// Deliberately narrower than `StreamEvent`: providers never know the
/// persisted row id, provider/model labels, or final duration - only
/// `commands.rs` does, so `Done`/`Error` are constructed there exclusively.
#[derive(Debug, Clone)]
pub enum ProviderEvent {
    Delta { text: String },
    Reasoning { text: String },
}

/// What crosses IPC to the webview on the `stream://{stream_id}` channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta {
        text: String,
    },
    Reasoning {
        text: String,
    },
    Done {
        /// `None` when nothing was persisted (an empty reply) - the frontend
        /// drops its pending bubble instead of trying to reconcile an id.
        message_id: Option<i64>,
        provider: String,
        model: String,
        created_at: i64,
        tokens_in: Option<i64>,
        tokens_out: Option<i64>,
        duration_ms: i64,
    },
    Error {
        message: String,
        /// Set when partial output was still persisted before the error, so
        /// the frontend can reconcile the pending bubble rather than leave it
        /// stuck at its sentinel id.
        message_id: Option<i64>,
    },
}

#[derive(thiserror::Error, Debug)]
pub enum ProviderError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("http {status}: {body}")]
    Http { status: u16, body: String },
    #[error("unexpected response shape: {0}")]
    Shape(String),
    #[error("cancelled")]
    Cancelled,
}

pub type ProviderResult<T> = Result<T, ProviderError>;

#[async_trait]
pub trait Provider: Send + Sync {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>>;

    async fn stream_chat(
        &self,
        req: ChatRequest,
        tx: mpsc::Sender<ProviderEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage>;
}

pub fn build_provider(http: &reqwest::Client, cfg: &ProviderConfig) -> Box<dyn Provider> {
    match cfg.dialect {
        Dialect::OpenaiCompat => Box::new(openai_compat::OpenAiCompatProvider::new(http, cfg)),
        Dialect::Ollama => Box::new(ollama::OllamaProvider::new(http, cfg)),
        Dialect::Anthropic => Box::new(anthropic::AnthropicProvider::new(http, cfg)),
        Dialect::Gemini => Box::new(gemini::GeminiProvider::new(http, cfg)),
        Dialect::Openai => Box::new(openai::OpenaiProvider::new(http, cfg)),
    }
}

/// Cap on how much of an HTTP error body we keep. Bodies are
/// provider/proxy-controlled and unbounded - a misconfigured gateway's HTML
/// error page can be megabytes - and shipping that whole and un-redacted into
/// an emitted event and a log line is both wasteful and a leak risk.
const MAX_ERROR_BODY: usize = 2048;

/// Reads a capped, API-key-redacted snippet of an HTTP error response body.
/// Some gateways echo the `Authorization` header back inside their error
/// payload; redaction only kicks in once the key is at least 8 chars so a
/// placeholder value doesn't get shredded into `[redacted]` everywhere.
pub async fn read_error_body(resp: reqwest::Response, api_key: &str) -> String {
    let body = resp.text().await.unwrap_or_default();
    let truncated: String = body.chars().take(MAX_ERROR_BODY).collect();
    if api_key.is_empty() {
        truncated
    } else {
        truncated.replace(api_key, "[redacted]")
    }
}

/// Accumulates raw bytes from a streaming HTTP body and yields complete
/// newline-terminated lines, holding back any trailing partial line until
/// more bytes arrive. Shared by the SSE (OpenAI-compatible) and NDJSON
/// (Ollama) parsers - both dialects are "framed by newlines", they just
/// disagree on what's inside each frame.
#[derive(Default)]
pub struct LineSplitter {
    buffer: Vec<u8>,
}

impl LineSplitter {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=pos).collect();
            let line = &line[..line.len() - 1];
            let line = if line.ends_with(b"\r") {
                &line[..line.len() - 1]
            } else {
                line
            };
            lines.push(String::from_utf8_lossy(line).into_owned());
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_complete_lines() {
        let mut splitter = LineSplitter::default();
        let lines = splitter.push(b"line one\nline two\n");
        assert_eq!(lines, vec!["line one", "line two"]);
    }

    #[test]
    fn holds_back_partial_line_across_chunks() {
        let mut splitter = LineSplitter::default();
        assert_eq!(splitter.push(b"partial line wi"), Vec::<String>::new());
        let lines = splitter.push(b"th more text\nsecond\n");
        assert_eq!(lines, vec!["partial line with more text", "second"]);
    }

    #[test]
    fn handles_crlf() {
        let mut splitter = LineSplitter::default();
        let lines = splitter.push(b"one\r\ntwo\r\n");
        assert_eq!(lines, vec!["one", "two"]);
    }

    #[test]
    fn handles_empty_lines_between_frames() {
        let mut splitter = LineSplitter::default();
        let lines = splitter.push(b"data: a\n\ndata: b\n\n");
        assert_eq!(lines, vec!["data: a", "", "data: b", ""]);
    }
}
