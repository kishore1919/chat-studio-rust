use super::{ChatRequest, ModelInfo, Provider, ProviderError, ProviderResult, StreamEvent, Usage, LineSplitter};
use crate::config::ProviderConfig;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub struct OpenAiCompatProvider {
    base_url: String,
    api_key: String,
    extra_headers: std::collections::BTreeMap<String, String>,
    client: reqwest::Client,
}

impl OpenAiCompatProvider {
    pub fn new(cfg: &ProviderConfig) -> Self {
        Self {
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            api_key: cfg.api_key.clone(),
            extra_headers: cfg.extra_headers.clone(),
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

#[async_trait]
impl Provider for OpenAiCompatProvider {
    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        let resp = self.request(reqwest::Method::GET, "/models").send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
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
        tx: mpsc::Sender<StreamEvent>,
        cancel: CancellationToken,
    ) -> ProviderResult<Usage> {
        let mut body = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
        });

        if let Some(effort) = req.reasoning_effort {
            if effort == "low" || effort == "medium" || effort == "high" {
                let max_tokens = match effort.as_str() {
                    "low" => 2048,
                    "high" => 8192,
                    _ => 4096,
                };
                body["reasoning"] = json!({
                    "effort": effort,
                    "max_tokens": max_tokens,
                });
            }
        }

        let resp = self
            .request(reqwest::Method::POST, "/chat/completions")
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
                        match parse_sse_line(&line) {
                            SseLine::Data(payload) => {
                                let Ok(parsed) = serde_json::from_str::<ChatChunk>(payload) else {
                                    continue;
                                };
                                if let Some(choice) = parsed.choices.into_iter().next() {
                                    if let Some(text) = choice.delta.content {
                                        if !text.is_empty() {
                                            let _ = tx.send(StreamEvent::Delta { text }).await;
                                        }
                                    }
                                    if let Some(text) = choice.delta.reasoning_content {
                                        if !text.is_empty() {
                                            let _ = tx.send(StreamEvent::Reasoning { text }).await;
                                        }
                                    }
                                }
                                if let Some(u) = parsed.usage {
                                    usage.tokens_in = u.prompt_tokens;
                                    usage.tokens_out = u.completion_tokens;
                                }
                            }
                            SseLine::Done => {
                                return Ok(usage);
                            }
                            SseLine::Comment | SseLine::Blank => {}
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
