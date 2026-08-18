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
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    base_url: String,
    api_key: String,
    extra_headers: std::collections::BTreeMap<String, String>,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(http: &reqwest::Client, cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
            extra_headers: cfg.extra_headers.clone(),
            client: http.clone(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .client
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json");
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

#[derive(Deserialize, Debug)]
struct StreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<Delta>,
    #[serde(default)]
    content_block: Option<ContentBlock>,
    #[serde(default)]
    message: Option<MessageStart>,
    #[serde(default)]
    usage: Option<UsageDelta>,
}

#[derive(Deserialize, Debug)]
struct Delta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Deserialize, Debug)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[allow(dead_code)]
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Deserialize, Debug)]
struct MessageStart {
    #[serde(default)]
    usage: Option<InputUsage>,
}

#[derive(Deserialize, Debug)]
struct InputUsage {
    #[serde(default)]
    input_tokens: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct UsageDelta {
    #[allow(dead_code)]
    #[serde(default)]
    input_tokens: Option<i64>,
    #[serde(default)]
    output_tokens: Option<i64>,
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
impl Provider for AnthropicProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self
            .request(reqwest::Method::GET, "/v1/models")
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
        let (system, messages): (Option<String>, Vec<serde_json::Value>) = {
            let mut system = None;
            let mut msgs = Vec::new();
            for m in &req.messages {
                if m.role == "system" && system.is_none() {
                    system = Some(m.content.clone());
                } else {
                    msgs.push(json!({"role": m.role, "content": m.content}));
                }
            }
            (system, msgs)
        };

        let mut body = json!({
            "model": req.model,
            "messages": messages,
            "stream": true,
            "max_tokens": 8192,
        });
        if let Some(s) = system {
            body["system"] = json!(s);
        }

        let resp = self
            .request(reqwest::Method::POST, "/v1/messages")
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
        let mut pending_event: Option<String> = None;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = chunk?;
                    for line in splitter.push(&chunk) {
                        if line.is_empty() {
                            pending_event = None;
                            continue;
                        }
                        if let Some(rest) = line.strip_prefix("event:") {
                            pending_event = Some(rest.trim().to_string());
                            continue;
                        }
                        if let Some(rest) = line.strip_prefix("data:") {
                            let payload = rest.trim_start();
                            let parsed = match serde_json::from_str::<StreamEvent>(payload) {
                                Ok(p) => p,
                                Err(e) => {
                                    shape_error.get_or_insert_with(|| format!("unparseable stream chunk: {e}"));
                                    continue;
                                }
                            };

                            match parsed.event_type.as_str() {
                                "message_start" => {
                                    if let Some(msg) = parsed.message {
                                        if let Some(u) = msg.usage {
                                            usage.tokens_in = u.input_tokens;
                                        }
                                    }
                                }
                                "content_block_start" => {
                                    if let Some(block) = parsed.content_block {
                                        if block.block_type == "thinking" {
                                            if let Some(text) = block.thinking {
                                                if !text.is_empty() {
                                                    emitted = true;
                                                    if tx.send(ProviderEvent::Reasoning { text }).await.is_err() {
                                                        return Err(ProviderError::Cancelled);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = parsed.delta {
                                        match delta.delta_type.as_deref() {
                                            Some("text_delta") => {
                                                if let Some(text) = delta.text {
                                                    if !text.is_empty() {
                                                        emitted = true;
                                                        if tx.send(ProviderEvent::Delta { text }).await.is_err() {
                                                            return Err(ProviderError::Cancelled);
                                                        }
                                                    }
                                                }
                                            }
                                            Some("thinking_delta") => {
                                                if let Some(text) = delta.thinking {
                                                    if !text.is_empty() {
                                                        emitted = true;
                                                        if tx.send(ProviderEvent::Reasoning { text }).await.is_err() {
                                                            return Err(ProviderError::Cancelled);
                                                        }
                                                    }
                                                }
                                            }
                                            Some("input_json_delta") => {}
                                            _ => {
                                                if let Some(text) = delta.text {
                                                    if !text.is_empty() {
                                                        emitted = true;
                                                        if tx.send(ProviderEvent::Delta { text }).await.is_err() {
                                                            return Err(ProviderError::Cancelled);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                "message_delta" => {
                                    if let Some(u) = parsed.usage {
                                        if let Some(t) = u.output_tokens {
                                            usage.tokens_out = Some(t);
                                        }
                                    }
                                    if let Some(delta) = parsed.delta {
                                        if let Some(t) = delta.stop_reason {
                                            let _ = t;
                                        }
                                    }
                                }
                                "message_stop" => {
                                    return finalize(emitted, shape_error, usage);
                                }
                                _ => {
                                    let _ = pending_event.take();
                                }
                            }
                        } else if line.starts_with(':') {
                            continue;
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
    fn parses_text_delta() {
        let payload = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let parsed: StreamEvent = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed.event_type, "content_block_delta");
        assert_eq!(parsed.delta.unwrap().text.as_deref(), Some("Hello"));
    }

    #[test]
    fn parses_thinking_delta() {
        let payload = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step one"}}"#;
        let parsed: StreamEvent = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed.delta.unwrap().thinking.as_deref(), Some("step one"));
    }

    #[test]
    fn parses_message_start_with_usage() {
        let payload = r#"{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","usage":{"input_tokens":12}}}"#;
        let parsed: StreamEvent = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed.event_type, "message_start");
        assert_eq!(
            parsed.message.unwrap().usage.unwrap().input_tokens,
            Some(12)
        );
    }

    #[test]
    fn parses_message_delta_with_output_tokens() {
        let payload = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":34}}"#;
        let parsed: StreamEvent = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed.event_type, "message_delta");
        assert_eq!(parsed.usage.unwrap().output_tokens, Some(34));
    }
}
