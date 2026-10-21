use anyhow::{Context, Result, ensure};
use futures::StreamExt;
use reqwest::{RequestBuilder, Response, header::HeaderValue};
use serde_json::{Value, json};
use url::Url;

use crate::{
    catalog::{Operation, Provider, Transport},
    network::{Network, RESPONSE_LIMIT, body},
};

pub struct Authentication {
    pub header: Option<(http::HeaderName, HeaderValue)>,
}
impl Authentication {
    fn apply(&self, request: RequestBuilder) -> RequestBuilder {
        if let Some((name, value)) = &self.header {
            request.header(name, value.clone())
        } else {
            request
        }
    }
}

pub async fn execute<F, Fut>(
    network: &Network,
    provider: &Provider,
    operation: &Operation,
    arguments: Value,
    authentication: &Authentication,
    authorize: F,
) -> Result<Value>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let mut url = Url::parse(&provider.endpoint)?;
    match &operation.transport {
        Transport::Mcp { tool } => {
            let client = network.client(url.as_str()).await?;
            let mut session = McpSession {
                client,
                endpoint: url.to_string(),
                authentication,
                session_id: None,
                protocol: "2025-11-25".into(),
            };
            let result = async {
                let initialized=session.rpc(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"Relay","version":env!("CARGO_PKG_VERSION")}}}),Some(1)).await?;
                let protocol = initialized["result"]["protocolVersion"]
                    .as_str()
                    .context("invalid MCP initialization")?;
                ensure!(
                    ["2025-03-26", "2025-06-18", "2025-11-25"].contains(&protocol),
                    "unsupported MCP protocol"
                );
                session.protocol = protocol.into();
                session
                    .rpc(
                        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                        None,
                    )
                    .await?;
                authorize().await?;
                let response=session.rpc(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":tool,"arguments":arguments}}),Some(2)).await?;
                let result = response.get("result").context("MCP operation failed")?.clone();
                ensure!(result["content"].is_array(), "invalid MCP tool result");
                Ok::<_, anyhow::Error>(result)
            }.await;
            // Explicit cleanup is bounded and contains no user-visible provider error body.
            if let Some(id) = session.session_id.take() {
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    authentication
                        .apply(session.client.delete(&session.endpoint))
                        .header("Mcp-Session-Id", id)
                        .header("MCP-Protocol-Version", &session.protocol)
                        .send(),
                )
                .await;
            }
            result
        }
        Transport::Http { method, path } => {
            let (api_url, arguments) =
                crate::catalog::operation_url(&provider.endpoint, path, &arguments)?;
            url = api_url;
            let client = network.client(url.as_str()).await?;
            let mut request = client.request(method.parse()?, url);
            if method == "GET" || method == "DELETE" {
                let values = arguments
                    .as_object()
                    .context("object arguments required")?
                    .iter()
                    .map(|(key, value)| {
                        ensure!(
                            value.is_string() || value.is_number() || value.is_boolean(),
                            "query arguments must be scalar values"
                        );
                        Ok((
                            key.clone(),
                            value
                                .as_str()
                                .map_or_else(|| value.to_string(), str::to_owned),
                        ))
                    })
                    .collect::<Result<Vec<_>>>()?;
                request = request.query(&values);
            } else {
                request = request.json(&arguments);
            }
            authorize().await?;
            json_response(authentication.apply(request).send().await?).await
        }
        Transport::Graphql { path, document } => {
            let (api_url, arguments) =
                crate::catalog::operation_url(&provider.endpoint, path, &arguments)?;
            url = api_url;
            let client = network.client(url.as_str()).await?;
            let request = authentication.apply(
                client
                    .post(url)
                    .json(&json!({"query":document,"variables":arguments})),
            );
            authorize().await?;
            json_response(request.send().await?).await
        }
    }
}

async fn json_response(response: Response) -> Result<Value> {
    let bytes = body(response, RESPONSE_LIMIT).await?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).context("provider returned an invalid JSON response")
}

struct McpSession<'a> {
    client: reqwest::Client,
    endpoint: String,
    authentication: &'a Authentication,
    session_id: Option<HeaderValue>,
    protocol: String,
}
impl McpSession<'_> {
    async fn rpc(&mut self, message: Value, id: Option<i64>) -> Result<Value> {
        let mut request = self
            .authentication
            .apply(self.client.post(&self.endpoint))
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", &self.protocol)
            .json(&message);
        if let Some(session) = &self.session_id {
            request = request.header("Mcp-Session-Id", session.clone());
        }
        let response = request.send().await?;
        ensure!(
            response.status().is_success(),
            "MCP provider request failed"
        );
        if let Some(session) = response.headers().get("Mcp-Session-Id") {
            ensure!(
                session.len() <= 512 && session.to_str().is_ok(),
                "invalid MCP session ID"
            );
            self.session_id = Some(session.clone());
        }
        let Some(id) = id else {
            return Ok(Value::Null);
        };
        let is_sse = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        if !is_sse {
            let result = json_response(response).await?;
            validate_rpc(&result, id)?;
            return Ok(result);
        }
        let mut parser = Sse::default();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if let Some(result) = parser.push(&chunk?, id)? {
                return Ok(result);
            }
        }
        anyhow::bail!("MCP stream ended without a result")
    }
}
fn validate_rpc(result: &Value, id: i64) -> Result<()> {
    ensure!(
        result["jsonrpc"] == "2.0"
            && result["id"] == id
            && result.get("method").is_none()
            && (result.get("result").is_some() ^ result.get("error").is_some()),
        "invalid MCP response"
    );
    Ok(())
}

#[derive(Default)]
struct Sse {
    pending: Vec<u8>,
    line: Vec<u8>,
    data: Vec<String>,
    total: usize,
    last_cr: bool,
}
impl Sse {
    /// Scan each byte once, including CRLF boundaries split across network chunks.
    fn push(&mut self, chunk: &[u8], id: i64) -> Result<Option<Value>> {
        self.total += chunk.len();
        ensure!(
            self.total <= RESPONSE_LIMIT,
            "MCP response exceeded its byte budget"
        );
        self.pending.extend_from_slice(chunk);
        for byte in std::mem::take(&mut self.pending) {
            if byte == b'\n' && self.last_cr {
                self.last_cr = false;
                continue;
            }
            self.last_cr = byte == b'\r';
            if byte == b'\n' || byte == b'\r' {
                if self.line.is_empty() {
                    if self.data.is_empty() {
                        continue;
                    }
                    let value: Value =
                        serde_json::from_str(&self.data.join("\n")).context("invalid MCP event")?;
                    self.data.clear();
                    ensure!(
                        value.get("method").is_none() || value.get("id").is_none(),
                        "server initiated MCP requests are unsupported"
                    );
                    if value["id"] == id {
                        validate_rpc(&value, id)?;
                        return Ok(Some(value));
                    }
                } else {
                    let line =
                        std::str::from_utf8(&self.line).context("invalid MCP event encoding")?;
                    if let Some(data) = line.strip_prefix("data:") {
                        self.data
                            .push(data.strip_prefix(' ').unwrap_or(data).into());
                    }
                    self.line.clear();
                }
            } else {
                self.line.push(byte);
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sse_handles_every_chunk_boundary_and_rejects_provider_requests() {
        let bytes = b"event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\r\n\r\n";
        for chunk_size in 1..bytes.len() {
            let mut parser = Sse::default();
            let mut result = None;
            for chunk in bytes.chunks(chunk_size) {
                result = parser.push(chunk, 2).unwrap().or(result);
            }
            assert_eq!(result.unwrap()["result"], json!({}));
        }
        assert!(Sse::default().push(b"data: {\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"sampling/createMessage\"}\n\n",2).is_err());
    }
}
