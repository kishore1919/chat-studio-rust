use super::{
    read_error_body, ChatRequest, LineSplitter, ModelInfo, Provider, ProviderError, ProviderEvent,
    ProviderResult, Usage,
};
use crate::config::ProviderConfig;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(20);
const EFFORTS: [&str; 3] = ["low", "medium", "high"];

pub struct OpenaiProvider {
    base_url: String,
    api_key: String,
    extra_headers: std::collections::BTreeMap<String, String>,
    disable_stream_options: bool,
    client: reqwest::Client,
}

impl OpenaiProvider {
    pub fn new(http: &reqwest::Client, cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
            extra_headers: cfg.extra_headers.clone(),
            disable_stream_options: cfg.disable_stream_options,
            client: http.clone(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .client
            .request(method, format!("{}{}", self.base_url, path));
        if !self.api_key.is_empty() {
            req = req.bearer_auth(&self.api_key);
        }
        for (k, v) in &self.extra_headers {
            req = req.header(k, v);
        }
        req
    }
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Deserialize, Default)]
struct ChatChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
    #[serde(default)]
    usage: Option<ChunkUsage>,
}

#[derive(Deserialize, Default)]
struct ChunkChoice {
    #[serde(default)]
    delta: ChunkDelta,
}

#[derive(Deserialize, Default)]
struct ChunkDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Deserialize)]
struct ChunkUsage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
}

#[derive(Debug, PartialEq)]
enum SseLine<'a> {
    Data(&'a str),
    Done,
    Comment,
    Blank,
}

fn parse_sse_line(line: &str) -> SseLine<'_> {
    if line.is_empty() {
        SseLine::Blank
    } else if let Some(rest) = line.strip_prefix("data:") {
        let payload = rest.trim_start();
        if payload == "[DONE]" {
            SseLine::Done
        } else {
            SseLine::Data(payload)
        }
    } else if line.starts_with(':') {
        SseLine::Comment
    } else {
        SseLine::Blank
    }
}

fn finalize(emitted: bool, shape_error: Option<String>, usage: Usage) -> ProviderResult<Usage> {
    if !emitted {
        if let Some(msg) = shape_error {
            return Err(ProviderError::Shape(msg));
        }
    }
    Ok(usage)
}

#[async_trait]
impl Provider for OpenaiProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self
            .request(reqwest::Method::GET, "/models")
            .timeout(LIST_MODELS_TIMEOUT)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = read_error_body(resp, &self.api_key).await;
            return Err(ProviderError::Http { status, body });
        }
        let parsed: ModelsResponse = resp.json().await?;
        Ok(parsed
            .data
            .into_iter()
            .map(|m| ModelInfo {
                display_name: m.id.clone(),
                id: m.id,
            })
            .collect())
    }

    async fn stream_chat(
        &self,
        req: ChatRequest,
        tx: mpsc::Sender<ProviderEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage> {
        let mut body = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
        });
        if !self.disable_stream_options {
            body["stream_options"] = json!({ "include_usage": true });
        }
        if let Some(effort) = req.reasoning_effort {
            if EFFORTS.contains(&effort.as_str()) {
                body["reasoning_effort"] = json!(effort);
            }
        }
        let resp = self
            .request(reqwest::Method::POST, "/chat/completions")
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = read_error_body(resp, &self.api_key).await;
            return Err(ProviderError::Http { status, body });
        }
        let mut stream = resp.bytes_stream();
        let mut splitter = LineSplitter::default();
        let mut usage = Usage::default();
        let mut emitted = false;
        let mut shape_error: Option<String> = None;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = chunk?;
                    for line in splitter.push(&chunk) {
                        match parse_sse_line(&line) {
                            SseLine::Data(payload) => {
                                let parsed = match serde_json::from_str::<ChatChunk>(payload) {
                                    Ok(parsed) => parsed,
                                    Err(e) => {
                                        shape_error.get_or_insert_with(|| format!("unparseable stream chunk: {e}"));
                                        continue;
                                    }
                                };
                                if let Some(choice) = parsed.choices.into_iter().next() {
                                    if let Some(text) = choice.delta.content {
                                        if !text.is_empty() {
                                            emitted = true;
                                            if tx.send(ProviderEvent::Delta { text }).await.is_err() {
                                                return Err(ProviderError::Cancelled);
                                            }
                                        }
                                    }
                                    if let Some(text) = choice.delta.reasoning_content {
                                        if !text.is_empty() {
                                            emitted = true;
                                            if tx.send(ProviderEvent::Reasoning { text }).await.is_err() {
                                                return Err(ProviderError::Cancelled);
                                            }
                                        }
                                    }
                                }
                                if let Some(u) = parsed.usage {
                                    usage.tokens_in = u.prompt_tokens;
                                    usage.tokens_out = u.completion_tokens;
                                }
                            }
                            SseLine::Done => {
                                return finalize(emitted, shape_error, usage);
                            }
                            SseLine::Comment | SseLine::Blank => {}
                        }
                    }
                }
            }
        }
        finalize(emitted, shape_error, usage)
    }
}
