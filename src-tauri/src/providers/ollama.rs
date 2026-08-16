use super::{ChatRequest, ModelInfo, Provider, ProviderError, ProviderResult, StreamEvent, Usage, LineSplitter};
use crate::config::ProviderConfig;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub struct OllamaProvider {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl OllamaProvider {
    pub fn new(cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
            client: reqwest::Client::new(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .client
            .request(method, format!("{}{}", self.base_url, path));
        if !self.api_key.is_empty() {
            req = req.bearer_auth(&self.api_key);
        }
        req
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<TagEntry>,
}

#[derive(Deserialize)]
struct TagEntry {
    name: String,
}

/// One line of Ollama's `/api/chat` NDJSON stream - unlike SSE this is not
/// framed with a `data:` prefix, each line IS a complete JSON object.
#[derive(Deserialize, Default)]
struct OllamaChatLine {
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    prompt_eval_count: Option<i64>,
    #[serde(default)]
    eval_count: Option<i64>,
    // Ollama reports its own wall-clock in nanoseconds; unused for now since
    // commands.rs measures duration itself, kept for schema completeness.
    #[serde(default)]
    #[allow(dead_code)]
    total_duration: Option<i64>,
}

#[derive(Deserialize, Default)]
struct OllamaMessage {
    #[serde(default)]
    content: String,
}

#[async_trait]
impl Provider for OllamaProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self.request(reqwest::Method::GET, "/api/tags").send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http { status, body });
        }
        let parsed: TagsResponse = resp.json().await?;
        Ok(parsed
            .models
            .into_iter()
            .map(|m| ModelInfo {
                display_name: m.name.clone(),
                id: m.name,
            })
            .collect())
    }

    async fn stream_chat(
        &self,
        req: ChatRequest,
        tx: mpsc::Sender<StreamEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage> {
        let body = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
        });

        let resp = self
            .request(reqwest::Method::POST, "/api/chat")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http { status, body });
        }

        let mut stream = resp.bytes_stream();
        let mut splitter = LineSplitter::default();
        let mut usage = Usage::default();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = chunk?;
                    for line in splitter.push(&chunk) {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let Ok(parsed) = serde_json::from_str::<OllamaChatLine>(&line) else {
                            continue;
                        };
                        if let Some(msg) = parsed.message {
                            if !msg.content.is_empty() {
                                let _ = tx.send(StreamEvent::Delta { text: msg.content }).await;
                            }
                        }
                        if parsed.done {
                            usage.tokens_in = parsed.prompt_eval_count;
                            usage.tokens_out = parsed.eval_count;
                            return Ok(usage);
                        }
                    }
                }
            }
        }

        Ok(usage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_delta_line() {
        let line = r#"{"message":{"role":"assistant","content":"hi"},"done":false}"#;
        let parsed: OllamaChatLine = serde_json::from_str(line).unwrap();
        assert_eq!(parsed.message.unwrap().content, "hi");
        assert!(!parsed.done);
    }

    #[test]
    fn parses_final_line_with_usage() {
        let line = r#"{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":12,"eval_count":34,"total_duration":5000000}"#;
        let parsed: OllamaChatLine = serde_json::from_str(line).unwrap();
        assert!(parsed.done);
        assert_eq!(parsed.prompt_eval_count, Some(12));
        assert_eq!(parsed.eval_count, Some(34));
    }

    #[test]
    fn ndjson_lines_split_correctly_across_chunks() {
        let mut splitter = LineSplitter::default();
        let mut lines = splitter.push(b"{\"message\":{\"content\":\"a");
        lines.extend(splitter.push(b"b\"},\"done\":false}\n{\"message\":{\"content\":\"c\"},\"done\":true}\n"));
        assert_eq!(lines.len(), 2);
        let first: OllamaChatLine = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(first.message.unwrap().content, "ab");
        let second: OllamaChatLine = serde_json::from_str(&lines[1]).unwrap();
        assert!(second.done);
    }
}
