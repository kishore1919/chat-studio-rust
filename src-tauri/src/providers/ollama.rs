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

/// Applied only to the non-streaming `list_models` call - a chat stream must
/// never carry a whole-request deadline (see `AppState::http`'s doc comment).
const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(20);

pub struct OllamaProvider {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl OllamaProvider {
    pub fn new(http: &reqwest::Client, cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
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
    /// Populated only when the request set `"think": true`. Previously
    /// discarded entirely - Ollama's reasoning output never reached the UI.
    #[serde(default)]
    thinking: String,
}

/// An off-schema provider and an empty answer both currently look like
/// `Ok(Usage::default())` with nothing emitted - indistinguishable to the
/// caller. If every line failed to parse and nothing was ever sent, surface
/// that as a real error instead of a silent empty reply.
fn finalize(emitted: bool, shape_error: Option<String>, usage: Usage) -> ProviderResult<Usage> {
    if !emitted {
        if let Some(msg) = shape_error {
            return Err(ProviderError::Shape(msg));
        }
    }
    Ok(usage)
}

#[async_trait]
impl Provider for OllamaProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self
            .request(reqwest::Method::GET, "/api/tags")
            .timeout(LIST_MODELS_TIMEOUT)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = read_error_body(resp, &self.api_key).await;
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
        tx: mpsc::Sender<ProviderEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage> {
        let mut body = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
        });
        // Ollama's dialect has no notion of graduated effort levels - only a
        // think/don't-think switch - so any non-empty effort request maps to
        // enabling it. Previously this field was dropped entirely.
        if req.reasoning_effort.is_some() {
            body["think"] = json!(true);
        }

        let resp = self
            .request(reqwest::Method::POST, "/api/chat")
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
                        if line.trim().is_empty() {
                            continue;
                        }
                        let parsed = match serde_json::from_str::<OllamaChatLine>(&line) {
                            Ok(parsed) => parsed,
                            Err(e) => {
                                shape_error.get_or_insert_with(|| format!("unparseable stream line: {e}"));
                                continue;
                            }
                        };
                        if let Some(msg) = parsed.message {
                            if !msg.thinking.is_empty() {
                                emitted = true;
                                if tx.send(ProviderEvent::Reasoning { text: msg.thinking }).await.is_err() {
                                    return Err(ProviderError::Cancelled);
                                }
                            }
                            if !msg.content.is_empty() {
                                emitted = true;
                                // A closed receiver means the coalescing task
                                // is gone (cancelled or panicked) - keep
                                // reading would just burn network and
                                // provider budget on a reply nobody wants.
                                if tx.send(ProviderEvent::Delta { text: msg.content }).await.is_err() {
                                    return Err(ProviderError::Cancelled);
                                }
                            }
                        }
                        if parsed.done {
                            usage.tokens_in = parsed.prompt_eval_count;
                            usage.tokens_out = parsed.eval_count;
                            return finalize(emitted, shape_error, usage);
                        }
                    }
                }
            }
        }

        finalize(emitted, shape_error, usage)
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
    fn parses_thinking_field_when_present() {
        let line =
            r#"{"message":{"role":"assistant","content":"","thinking":"step one"},"done":false}"#;
        let parsed: OllamaChatLine = serde_json::from_str(line).unwrap();
        assert_eq!(parsed.message.unwrap().thinking, "step one");
    }

    #[test]
    fn thinking_defaults_empty_when_absent() {
        let line = r#"{"message":{"role":"assistant","content":"hi"},"done":false}"#;
        let parsed: OllamaChatLine = serde_json::from_str(line).unwrap();
        assert_eq!(parsed.message.unwrap().thinking, "");
    }

    #[test]
    fn ndjson_lines_split_correctly_across_chunks() {
        let mut splitter = LineSplitter::default();
        let mut lines = splitter.push(b"{\"message\":{\"content\":\"a");
        lines.extend(
            splitter
                .push(b"b\"},\"done\":false}\n{\"message\":{\"content\":\"c\"},\"done\":true}\n"),
        );
        assert_eq!(lines.len(), 2);
        let first: OllamaChatLine = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(first.message.unwrap().content, "ab");
        let second: OllamaChatLine = serde_json::from_str(&lines[1]).unwrap();
        assert!(second.done);
    }
}
