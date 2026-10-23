use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, net::IpAddr};
use url::Url;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub version: String,
    pub name: String,
    pub endpoint: String,
    pub authentication: Authentication,
    pub operations: BTreeMap<String, Operation>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Authentication {
    None,
    Bearer,
    ApiKey {
        header: String,
    },
    #[serde(rename_all = "camelCase")]
    OAuth2 {
        authorization_endpoint: Option<String>,
        token_endpoint: String,
        revocation_endpoint: Option<String>,
        client_id: String,
        /// Name of a backend application-secret file, never an end-user access token.
        client_secret_file: Option<String>,
        #[serde(default)]
        client_authentication: OAuthClientAuthentication,
        grant: OAuthGrant,
        scopes: Vec<String>,
    },
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OAuthGrant {
    AuthorizationCode,
    ClientCredentials,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OAuthClientAuthentication {
    #[default]
    None,
    ClientSecretPost,
    ClientSecretBasic,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
    pub required_scopes: Vec<String>,
    pub transport: Transport,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Transport {
    Mcp { tool: String },
    Http { method: String, path: String },
    Graphql { path: String, document: String },
}

pub struct Catalog {
    providers: BTreeMap<String, Provider>,
    validators: BTreeMap<(String, String), jsonschema::Validator>,
}

pub fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

pub fn endpoint(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).context("invalid provider URL")?;
    ensure!(
        url.scheme() == "https"
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none(),
        "provider URLs require HTTPS on port 443 without credentials or fragments"
    );
    let host = url.host_str().context("provider hostname required")?;
    ensure!(
        host.contains('.')
            && host.parse::<IpAddr>().is_err()
            && !host.ends_with('.')
            && ![".local", ".localhost", ".internal"]
                .iter()
                .any(|suffix| host.ends_with(suffix)),
        "public provider DNS name required"
    );
    Ok(url)
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0))
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(_) => false,
    }
}

fn validate_path(path: &str) -> Result<()> {
    ensure!(
        path.starts_with('/')
            && !path.starts_with("//")
            && !path.contains(['?', '#', '\\', '%'])
            && path.split('/').all(|part| part != "." && part != "..")
            && !path.chars().any(char::is_control),
        "operation path must be a fixed absolute path"
    );
    for segment in path.split('/') {
        if segment.contains(['{', '}']) {
            ensure!(
                segment.starts_with('{')
                    && segment.ends_with('}')
                    && identifier(&segment[1..segment.len() - 1]),
                "path parameters must occupy a complete named segment"
            );
        }
    }
    Ok(())
}

pub fn operation_url(base: &str, path: &str, arguments: &Value) -> Result<(Url, Value)> {
    let mut url = endpoint(base)?;
    let mut remaining = arguments
        .as_object()
        .context("object arguments required")?
        .clone();
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("provider URL cannot hold path segments"))?;
    segments.clear();
    for segment in path
        .strip_prefix('/')
        .context("absolute operation path required")?
        .split('/')
    {
        if let Some(name) = segment
            .strip_prefix('{')
            .and_then(|part| part.strip_suffix('}'))
        {
            let value = arguments.get(name).context("missing API path argument")?;
            remaining.remove(name);
            let value = value
                .as_str()
                .context("API path argument must be a string")?;
            ensure!(
                !value.is_empty()
                    && value.len() <= 512
                    && !matches!(value, "." | "..")
                    && !value.contains(['/', '\\', '%'])
                    && !value.chars().any(char::is_control),
                "invalid API path argument"
            );
            segments.push(value);
        } else {
            segments.push(segment);
        }
    }
    drop(segments);
    Ok((url, Value::Object(remaining)))
}

impl Catalog {
    pub fn from_json(raw: &[u8]) -> Result<Self> {
        ensure!(raw.len() <= 1024 * 1024, "provider catalog is too large");
        let providers: Vec<Provider> =
            serde_json::from_slice(raw).context("invalid provider catalog")?;
        ensure!(providers.len() <= 128, "too many providers");
        let mut catalog = Self {
            providers: BTreeMap::new(),
            validators: BTreeMap::new(),
        };
        for provider in providers {
            ensure!(
                identifier(&provider.id)
                    && identifier(&provider.version)
                    && !provider.name.is_empty()
                    && provider.name.len() <= 128
                    && !catalog.providers.contains_key(&provider.id),
                "invalid provider identity"
            );
            endpoint(&provider.endpoint)?;
            match &provider.authentication {
                Authentication::ApiKey { header } => {
                    let name: http::HeaderName =
                        header.parse().context("invalid API key header")?;
                    ensure!(
                        !matches!(
                            name.as_str(),
                            "host"
                                | "cookie"
                                | "content-length"
                                | "transfer-encoding"
                                | "connection"
                                | "proxy-authorization"
                                | "accept"
                                | "content-type"
                        ),
                        "reserved API key header"
                    );
                }
                Authentication::OAuth2 {
                    authorization_endpoint,
                    token_endpoint,
                    revocation_endpoint,
                    client_id,
                    client_secret_file,
                    client_authentication,
                    grant,
                    scopes,
                } => {
                    endpoint(token_endpoint)?;
                    if let Some(url) = authorization_endpoint {
                        endpoint(url)?;
                    }
                    if let Some(url) = revocation_endpoint {
                        endpoint(url)?;
                    }
                    ensure!(
                        *grant != OAuthGrant::AuthorizationCode || authorization_endpoint.is_some(),
                        "OAuth authorization endpoint required"
                    );
                    ensure!(
                        !client_id.is_empty()
                            && client_id.len() <= 512
                            && scopes.len() <= 64
                            && scopes.iter().all(|s| !s.is_empty()
                                && s.len() <= 256
                                && !s.chars().any(char::is_whitespace)),
                        "invalid OAuth configuration"
                    );
                    if let Some(file) = client_secret_file {
                        ensure!(
                            file.starts_with("/var/run/secrets/relay/apps/")
                                && !file.contains(".."),
                            "application secret must be a mounted backend file"
                        );
                    }
                    ensure!(
                        (*client_authentication == OAuthClientAuthentication::None)
                            == client_secret_file.is_none(),
                        "OAuth client authentication and application secret do not match"
                    );
                    ensure!(
                        *grant != OAuthGrant::ClientCredentials || client_secret_file.is_some(),
                        "client-credentials flow requires application authentication"
                    );
                }
                _ => {}
            }
            ensure!(
                !provider.operations.is_empty() && provider.operations.len() <= 128,
                "invalid operation count"
            );
            for (name, operation) in &provider.operations {
                ensure!(
                    identifier(name)
                        && operation.description.len() <= 4096
                        && operation.input_schema["type"] == "object",
                    "invalid operation"
                );
                let validator = jsonschema::options()
                    .offline()
                    .should_validate_formats(true)
                    .should_ignore_unknown_formats(false)
                    .build(&operation.input_schema)
                    .map_err(|_| anyhow::anyhow!("invalid operation schema"))?;
                match &operation.transport {
                    Transport::Mcp { tool } => ensure!(identifier(tool), "invalid MCP tool"),
                    Transport::Http { method, path } => {
                        ensure!(
                            ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()),
                            "unsupported HTTP operation method"
                        );
                        validate_path(path)?;
                    }
                    Transport::Graphql { path, document } => {
                        validate_path(path)?;
                        ensure!(
                            !document.is_empty() && document.len() <= 65536,
                            "invalid GraphQL document"
                        );
                    }
                }
                catalog
                    .validators
                    .insert((provider.id.clone(), name.clone()), validator);
            }
            catalog.providers.insert(provider.id.clone(), provider);
        }
        Ok(catalog)
    }
    pub fn providers(&self) -> impl Iterator<Item = &Provider> {
        self.providers.values()
    }
    pub fn provider(&self, id: &str) -> Result<&Provider> {
        self.providers.get(id).context("provider unavailable")
    }
    pub fn operation(&self, provider: &str, name: &str, arguments: &Value) -> Result<&Operation> {
        ensure!(
            arguments.is_object() && serde_json::to_vec(arguments)?.len() <= 1024 * 1024,
            "invalid operation arguments"
        );
        let operation = self
            .provider(provider)?
            .operations
            .get(name)
            .context("operation unavailable")?;
        ensure!(
            self.validators
                .get(&(provider.to_owned(), name.to_owned()))
                .context("operation schema unavailable")?
                .is_valid(arguments),
            "arguments violate operation schema"
        );
        Ok(operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn provider(authentication: Value, transport: Value) -> Value {
        json!({"id":"provider","version":"v1","name":"Provider","endpoint":"https://api.example.com/mcp","authentication":authentication,
            "operations":{"read":{"description":"Read","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"additionalProperties":false},"readOnly":true,"requiredScopes":[],"transport":transport}}})
    }
    #[test]
    fn protocols_and_authentication_are_independent_and_schemas_fail_closed() {
        for auth in [
            json!({"kind":"none"}),
            json!({"kind":"bearer"}),
            json!({"kind":"apiKey","header":"x-api-key"}),
            json!({"kind":"oAuth2","authorizationEndpoint":"https://login.example.com/authorize","tokenEndpoint":"https://login.example.com/token","clientId":"public-client","grant":"authorizationCode","scopes":["read"]}),
        ] {
            for transport in [
                json!({"kind":"mcp","tool":"search"}),
                json!({"kind":"http","method":"GET","path":"/search"}),
                json!({"kind":"graphql","path":"/graphql","document":"query Search($query:String!){search(query:$query){name}}"}),
            ] {
                let catalog = Catalog::from_json(
                    &serde_json::to_vec(&json!([provider(auth.clone(), transport)])).unwrap(),
                )
                .unwrap();
                assert!(
                    catalog
                        .operation("provider", "read", &json!({"query":"hello"}))
                        .is_ok()
                );
                assert!(
                    catalog
                        .operation(
                            "provider",
                            "read",
                            &json!({"endpoint":"https://other.example"})
                        )
                        .is_err()
                );
                assert!(
                    catalog
                        .operation("provider", "unknown", &json!({}))
                        .is_err()
                );
            }
        }
    }
    #[test]
    fn example_catalog_is_valid_and_does_not_expose_arbitrary_routes() {
        let catalog = Catalog::from_json(include_bytes!("../catalog.example.json")).unwrap();
        assert!(
            catalog
                .operation(
                    "github-api",
                    "list_issues",
                    &json!({"owner":"team","repo":"project"})
                )
                .unwrap()
                .read_only
        );
        assert!(
            !catalog
                .operation(
                    "github-api",
                    "create_issue",
                    &json!({"owner":"team","repo":"project","title":"Example"})
                )
                .unwrap()
                .read_only
        );
    }
    #[test]
    fn api_path_arguments_cannot_escape_the_reviewed_route_or_destination() {
        let (url, rest) = operation_url(
            "https://api.example.com/",
            "/repos/{owner}/{repo}/issues",
            &json!({"owner":"team","repo":"my project","state":"open"}),
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.example.com/repos/team/my%20project/issues"
        );
        assert_eq!(rest, json!({"state":"open"}));
        for bad in ["..", ".", "other/repo", "%2e%2e", "other\\repo", ""] {
            assert!(
                operation_url(
                    "https://api.example.com/",
                    "/repos/{owner}/issues",
                    &json!({"owner":bad})
                )
                .is_err()
            );
        }
        for bad in [
            "//other.example/path",
            "/x/../secrets",
            "/x?url=other",
            "/x/{owner}-suffix",
            "/x/%2e%2e",
        ] {
            assert!(validate_path(bad).is_err());
        }
    }
    #[test]
    fn protected_destinations_and_credential_headers_are_rejected() {
        for bad in [
            "http://api.example.com/",
            "https://127.0.0.1/",
            "https://metadata.google.internal/",
            "https://user:token@api.example.com/",
            "https://api.example.com:8443/",
        ] {
            assert!(endpoint(bad).is_err());
        }
        for ip in [
            "10.0.0.1",
            "100.100.1.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.1.1",
            "192.168.0.1",
            "224.0.0.1",
            "::1",
            "::ffff:8.8.8.8",
        ] {
            assert!(!public_ip(ip.parse().unwrap()));
        }
        for header in [
            "host",
            "cookie",
            "proxy-authorization",
            "content-length",
            "connection",
        ] {
            assert!(
                Catalog::from_json(
                    &serde_json::to_vec(&json!([provider(
                        json!({"kind":"apiKey","header":header}),
                        json!({"kind":"http","method":"GET","path":"/"})
                    )]))
                    .unwrap()
                )
                .is_err()
            );
        }
    }
}
