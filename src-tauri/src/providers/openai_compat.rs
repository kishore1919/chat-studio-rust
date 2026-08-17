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

const EFFORTS: [&str; 3] = ["low", "medium", "high"];

pub struct OpenAiCompatProvider {
    base_url: String,
    api_key: String,
    extra_headers: std::collections::BTreeMap<String, String>,
    disable_stream_options: bool,
    client: reqwest::Client,
}

impl OpenAiCompatProvider {
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

/// One parsed SSE line. OpenAI-compatible streams frame each event as
/// `data: {json}\n\n`, with occasional `: comment` keep-alive lines
/// (OpenRouter) that must be skipped rather than parsed as JSON.
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
impl Provider for OpenAiCompatProvider {
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
            // Many endpoints never emit a `usage` block on the final SSE frame
            // otherwise, which is why tokens_in/tokens_out were silently NULL.
            body["stream_options"] = json!({ "include_usage": true });
        }

        if let Some(effort) = req.reasoning_effort {
            if EFFORTS.contains(&effort.as_str()) {
                // Standard top-level field per the OpenAI spec. The previous
                // version nested this under an OpenRouter-specific `reasoning`
                // object that NIM and most other endpoints simply ignore, and
                // hardcoded a `max_tokens` alongside it that silently capped
                // every "low"-effort answer at 2048 tokens.
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
                                            // A closed receiver means the coalescing
                                            // task is gone - stop burning network
                                            // and provider budget on a reply
                                            // nobody is listening for anymore.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_line() {
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[]}"#),
            SseLine::Data(r#"{"choices":[]}"#)
        );
    }

    #[test]
    fn parses_done_sentinel() {
        assert_eq!(parse_sse_line("data: [DONE]"), SseLine::Done);
    }

    #[test]
    fn skips_comment_lines() {
        assert_eq!(parse_sse_line(": keep-alive"), SseLine::Comment);
    }

    #[test]
    fn parses_blank_line() {
        assert_eq!(parse_sse_line(""), SseLine::Blank);
    }

    #[test]
    fn chunk_deserializes_delta_content() {
        let chunk: ChatChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{"content":"hi"}}]}"#).unwrap();
        assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("hi"));
    }

    #[test]
    fn chunk_deserializes_usage() {
        let chunk: ChatChunk = serde_json::from_str(
            r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#,
        )
        .unwrap();
        let usage = chunk.usage.unwrap();
        assert_eq!(usage.prompt_tokens, Some(10));
        assert_eq!(usage.completion_tokens, Some(5));
    }

    #[test]
    fn line_split_across_chunks_still_parses() {
        // Simulates a `data: {...}` frame arriving split across two TCP reads.
        let mut splitter = LineSplitter::default();
        let mut lines = splitter.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"hi");
        lines.extend(splitter.push(b"\"}}]}\n\n"));
        assert_eq!(lines.len(), 2);
        match parse_sse_line(&lines[0]) {
            SseLine::Data(payload) => {
                let chunk: ChatChunk = serde_json::from_str(payload).unwrap();
                assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("hi"));
            }
            other => panic!("expected data line, got {other:?}"),
        }
    }
}

/// End-to-end coverage against a real (mocked) HTTP server, rather than the
/// unit tests above which exercise the parser directly. Catches bugs the
/// parser tests can't: wrong URL path, error-body handling, and the
/// emitted-vs-shape-error distinction across a real `stream_chat` call.
#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::config::Dialect;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_config(base_url: String, api_key: &str) -> ProviderConfig {
        ProviderConfig {
            id: "test".into(),
            display_name: "Test".into(),
            dialect: Dialect::OpenaiCompat,
            base_url,
            api_key: api_key.into(),
            enabled: true,
            extra_headers: Default::default(),
            models: Vec::new(),
            disable_stream_options: false,
        }
    }

    fn empty_request() -> ChatRequest {
        ChatRequest {
            model: "test-model".into(),
            messages: vec![],
            reasoning_effort: None,
        }
    }

    #[tokio::test]
    async fn stream_chat_preserves_order_and_parses_usage() {
        let server = MockServer::start().await;
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\n",
            "data: [DONE]\n\n",
        );
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream"))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let provider = OpenAiCompatProvider::new(&client, &test_config(server.uri(), ""));
        let (tx, mut rx) = mpsc::channel(16);
        let usage = provider
            .stream_chat(empty_request(), tx, CancellationToken::new())
            .await
            .unwrap();

        let mut events = Vec::new();
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert_eq!(events.len(), 3, "expected Delta, Reasoning, Delta in order");
        match &events[0] {
            ProviderEvent::Delta { text } => assert_eq!(text, "Hel"),
            other => panic!("expected Delta first, got {other:?}"),
        }
        match &events[1] {
            ProviderEvent::Reasoning { text } => assert_eq!(text, "thinking"),
            other => panic!("expected Reasoning second, got {other:?}"),
        }
        match &events[2] {
            ProviderEvent::Delta { text } => assert_eq!(text, "lo"),
            other => panic!("expected Delta third, got {other:?}"),
        }
        assert_eq!(usage.tokens_in, Some(5));
        assert_eq!(usage.tokens_out, Some(2));
    }

    #[tokio::test]
    async fn http_error_body_is_truncated_and_key_redacted() {
        let server = MockServer::start().await;
        let api_key = "sk-supersecretkey1234567890";
        let huge_padding = "x".repeat(2_000_000);
        let huge_body =
            format!(r#"{{"error":"boom","echo":"Bearer {api_key}","pad":"{huge_padding}"}}"#);
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(500).set_body_raw(huge_body, "application/json"))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let provider = OpenAiCompatProvider::new(&client, &test_config(server.uri(), api_key));
        let (tx, _rx) = mpsc::channel(16);
        let err = provider
            .stream_chat(empty_request(), tx, CancellationToken::new())
            .await
            .unwrap_err();

        match err {
            ProviderError::Http { status, body } => {
                assert_eq!(status, 500);
                assert!(
                    body.len() < 3000,
                    "body should be capped, was {} bytes",
                    body.len()
                );
                assert!(
                    !body.contains(api_key),
                    "api key must not appear in the error body"
                );
                assert!(body.contains("[redacted]"));
            }
            other => panic!("expected Http error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn all_unparseable_lines_return_shape_error_not_empty_ok() {
        let server = MockServer::start().await;
        let body = "data: not json at all\n\ndata: also not json\n\n";
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream"))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let provider = OpenAiCompatProvider::new(&client, &test_config(server.uri(), ""));
        let (tx, _rx) = mpsc::channel(16);
        let err = provider
            .stream_chat(empty_request(), tx, CancellationToken::new())
            .await
            .unwrap_err();

        assert!(
            matches!(err, ProviderError::Shape(_)),
            "an off-schema stream that emits nothing must not look like Ok(empty), got {err:?}"
        );
    }

    #[tokio::test]
    #[ignore] // costs wall-clock time waiting for the read timeout to fire
    async fn read_timeout_fires_on_a_stalled_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(3)))
            .mount(&server)
            .await;

        let client = reqwest::Client::builder()
            .read_timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();
        let provider = OpenAiCompatProvider::new(&client, &test_config(server.uri(), ""));
        let (tx, _rx) = mpsc::channel(16);
        let result = provider
            .stream_chat(empty_request(), tx, CancellationToken::new())
            .await;

        assert!(
            result.is_err(),
            "a stalled response past read_timeout must error, not hang"
        );
    }
}
