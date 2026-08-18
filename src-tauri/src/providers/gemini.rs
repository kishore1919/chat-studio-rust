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

pub struct GeminiProvider {
    base_url: String,
    api_key: String,
    extra_headers: std::collections::BTreeMap<String, String>,
    client: reqwest::Client,
}

impl GeminiProvider {
    pub fn new(http: &reqwest::Client, cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
            extra_headers: cfg.extra_headers.clone(),
            client: http.clone(),
        }
    }

    fn request(&self, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        let mut req = self.client.request(method, url);
        if !self.api_key.is_empty() {
            req = req.header("x-goog-api-key", &self.api_key);
        }
        for (k, v) in &self.extra_headers {
            req = req.header(k, v);
        }
        req
    }

    fn models_url(&self) -> String {
        if self.base_url.ends_with("/v1beta") || self.base_url.ends_with("/v1") {
            format!("{}/models", self.base_url)
        } else {
            format!("{}/v1beta/models", self.base_url)
        }
    }

    fn stream_url(&self, model: &str) -> String {
        let base = if self.base_url.ends_with("/v1beta") || self.base_url.ends_with("/v1") {
            self.base_url.clone()
        } else {
            format!("{}/v1beta", self.base_url)
        };
        let escaped = urlencoding_simple(model);
        format!("{}/models/{}:streamGenerateContent?alt=sse", base, escaped)
    }
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
struct GeminiChunk {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default, rename = "usageMetadata")]
    usage_metadata: Option<UsageMeta>,
}

#[derive(Deserialize, Default, Debug)]
struct Candidate {
    #[serde(default)]
    content: Option<Content>,
}

#[derive(Deserialize, Default, Debug)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Deserialize, Default, Debug)]
struct Part {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thought: Option<bool>,
}

#[derive(Deserialize, Default, Debug)]
struct UsageMeta {
    #[serde(default, rename = "promptTokenCount")]
    prompt_token_count: Option<i64>,
    #[serde(default, rename = "candidatesTokenCount")]
    candidates_token_count: Option<i64>,
}

fn finalize(emitted: bool, shape_error: Option<String>, usage: Usage) -> ProviderResult<Usage> {
    if !emitted {
        if let Some(msg) = shape_error {
            return Err(ProviderError::Shape(msg));
        }
    }
    Ok(usage)
}

fn map_role(role: &str) -> &'static str {
    match role {
        "assistant" => "model",
        _ => "user",
    }
}

#[async_trait]
impl Provider for GeminiProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self
            .request(reqwest::Method::GET, self.models_url())
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
            .models
            .into_iter()
            .map(|m| {
                let id = m
                    .name
                    .strip_prefix("models/")
                    .unwrap_or(&m.name)
                    .to_string();
                let display = m.display_name.unwrap_or_else(|| id.clone());
                ModelInfo {
                    id,
                    display_name: display,
                }
            })
            .collect())
    }

    async fn stream_chat(
        &self,
        req: ChatRequest,
        tx: mpsc::Sender<ProviderEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage> {
        let mut system_text: Option<String> = None;
        let mut contents = Vec::new();
        for m in &req.messages {
            if m.role == "system" && system_text.is_none() {
                system_text = Some(m.content.clone());
            } else {
                let role = map_role(&m.role);
                contents.push(json!({
                    "role": role,
                    "parts": [{"text": m.content}]
                }));
            }
        }
        if contents.is_empty() {
            contents.push(json!({"role":"user","parts":[{"text":""}]}));
        }

        let mut body = json!({
            "contents": contents,
        });
        if let Some(s) = system_text {
            body["systemInstruction"] = json!({"parts": [{"text": s}]});
        }

        let url = self.stream_url(&req.model);
        let resp = self
            .request(reqwest::Method::POST, url)
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
                        let trimmed = line.trim();
                        if trimmed.is_empty() || trimmed == "[" || trimmed == "]" || trimmed == "," {
                            continue;
                        }
                        if trimmed.starts_with(':') {
                            continue;
                        }
                        let payload = if let Some(rest) = trimmed.strip_prefix("data:") {
                            let p = rest.trim_start();
                            if p == "[DONE]" {
                                continue;
                            }
                            p.trim_end_matches(',')
                        } else {
                            trimmed.trim_end_matches(',')
                        };
                        if payload.is_empty() || payload == "[" || payload == "]" {
                            continue;
                        }
                        let parsed = match serde_json::from_str::<GeminiChunk>(payload) {
                            Ok(p) => p,
                            Err(e) => {
                                shape_error.get_or_insert_with(|| format!("unparseable stream chunk: {e}"));
                                continue;
                            }
                        };
                        for candidate in parsed.candidates {
                            if let Some(content) = candidate.content {
                                for part in content.parts {
                                    if let Some(text) = part.text {
                                        if text.is_empty() {
                                            continue;
                                        }
                                        let is_thought = part.thought.unwrap_or(false);
                                        emitted = true;
                                        let event = if is_thought {
                                            ProviderEvent::Reasoning { text }
                                        } else {
                                            ProviderEvent::Delta { text }
                                        };
                                        if tx.send(event).await.is_err() {
                                            return Err(ProviderError::Cancelled);
                                        }
                                    }
                                }
                            }
                        }
                        if let Some(u) = parsed.usage_metadata {
                            if let Some(t) = u.prompt_token_count {
                                usage.tokens_in = Some(t);
                            }
                            if let Some(t) = u.candidates_token_count {
                                usage.tokens_out = Some(t);
                            }
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
    fn maps_assistant_to_model() {
        assert_eq!(map_role("assistant"), "model");
        assert_eq!(map_role("user"), "user");
        assert_eq!(map_role("system"), "user");
    }

    #[test]
    fn parses_gemini_chunk_with_text() {
        let payload = r#"{"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}"#;
        let parsed: GeminiChunk = serde_json::from_str(payload).unwrap();
        assert_eq!(
            parsed.candidates[0].content.as_ref().unwrap().parts[0]
                .text
                .as_deref(),
            Some("Hello")
        );
    }

    #[test]
    fn parses_thought_part() {
        let payload =
            r#"{"candidates":[{"content":{"parts":[{"text":"thinking","thought":true}]}}]}"#;
        let parsed: GeminiChunk = serde_json::from_str(payload).unwrap();
        let part = &parsed.candidates[0].content.as_ref().unwrap().parts[0];
        assert_eq!(part.thought, Some(true));
        assert_eq!(part.text.as_deref(), Some("thinking"));
    }

    #[test]
    fn parses_usage_metadata() {
        let payload =
            r#"{"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}"#;
        let parsed: GeminiChunk = serde_json::from_str(payload).unwrap();
        let usage = parsed.usage_metadata.unwrap();
        assert_eq!(usage.prompt_token_count, Some(10));
        assert_eq!(usage.candidates_token_count, Some(5));
    }

    #[test]
    fn url_encodes_model_slashes() {
        let encoded = urlencoding_simple("gemini-2.0/flash");
        assert!(encoded.contains("%2F"));
    }

    #[test]
    fn models_url_appends_correctly() {
        let http = reqwest::Client::new();
        let cfg = crate::config::ProviderConfig {
            id: "test".into(),
            display_name: "Test".into(),
            dialect: crate::config::Dialect::Gemini,
            base_url: "https://generativelanguage.googleapis.com".into(),
            api_key: "".into(),
            enabled: true,
            extra_headers: Default::default(),
            models: vec![],
            disable_stream_options: false,
        };
        let p = GeminiProvider::new(&http, &cfg);
        assert_eq!(
            p.models_url(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );

        let cfg2 = crate::config::ProviderConfig {
            base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
            ..cfg
        };
        let p2 = GeminiProvider::new(&http, &cfg2);
        assert_eq!(
            p2.models_url(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
    }
}
