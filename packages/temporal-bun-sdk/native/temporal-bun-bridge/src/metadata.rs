//! Metadata normalization and TLS parsing utilities used by the FFI bridge.

use std::collections::HashMap;

use base64::{engine::general_purpose, Engine as _};
use temporal_client::{ClientTlsConfig, TlsConfig};

use super::{BridgeError, ClientTlsConfigPayload};

pub(crate) fn extract_bearer_token(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    let (scheme, token) = trimmed.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") {
        let token = token.trim();
        if token.is_empty() {
            None
        } else {
            Some(token)
        }
    } else {
        None
    }
}

pub(crate) fn normalize_metadata_headers(
    raw_headers: HashMap<String, String>,
) -> Result<(HashMap<String, String>, Option<String>), BridgeError> {
    let mut normalized: HashMap<String, String> = HashMap::with_capacity(raw_headers.len());
    let mut bearer: Option<String> = None;

    for (key, value) in raw_headers.into_iter() {
        let trimmed_key = key.trim();
        if trimmed_key.is_empty() {
            return Err(BridgeError::InvalidMetadata(
                "header keys must be non-empty".into(),
            ));
        }

        let lower_key = trimmed_key.to_ascii_lowercase();
        if normalized.contains_key(&lower_key) || (lower_key == "authorization" && bearer.is_some())
        {
            return Err(BridgeError::InvalidMetadata(format!(
                "duplicate header key '{lower_key}'",
            )));
        }

        let trimmed_value = value.trim();
        if trimmed_value.is_empty() {
            return Err(BridgeError::InvalidMetadata(format!(
                "header '{lower_key}' must have a non-empty value",
            )));
        }

        if lower_key == "authorization" {
            if let Some(token) = extract_bearer_token(trimmed_value) {
                bearer = Some(token.to_string());
                continue;
            }
        }

        normalized.insert(lower_key, trimmed_value.to_string());
    }

    Ok((normalized, bearer))
}

pub(crate) fn tls_config_from_payload(
    payload: ClientTlsConfigPayload,
) -> Result<TlsConfig, BridgeError> {
    let ClientTlsConfigPayload {
        server_root_ca_cert,
        client_cert,
        client_private_key,
        server_name_override,
        client_cert_pair,
    } = payload;

    let mut tls = TlsConfig::default();

    if let Some(server_root_ca) = server_root_ca_cert {
        let bytes = decode_base64(&server_root_ca).map_err(|err| {
            BridgeError::InvalidTlsConfig(format!(
                "invalid serverRootCACertificate/server_root_ca_cert: {err}",
            ))
        })?;
        tls.server_root_ca_cert = Some(bytes);
    }

    if let Some(pair) = client_cert_pair {
        let cert = decode_base64(&pair.crt).map_err(|err| {
            BridgeError::InvalidTlsConfig(format!("invalid clientCertPair.crt: {err}"))
        })?;
        let key = decode_base64(&pair.key).map_err(|err| {
            BridgeError::InvalidTlsConfig(format!("invalid clientCertPair.key: {err}"))
        })?;
        tls.client_tls_config = Some(ClientTlsConfig {
            client_cert: cert,
            client_private_key: key,
        });
    } else {
        match (client_cert, client_private_key) {
            (Some(cert_b64), Some(key_b64)) => {
                let cert = decode_base64(&cert_b64).map_err(|err| {
                    BridgeError::InvalidTlsConfig(format!("invalid client_cert/clientCert: {err}",))
                })?;
                let key = decode_base64(&key_b64).map_err(|err| {
                    BridgeError::InvalidTlsConfig(format!(
                        "invalid client_private_key/clientPrivateKey: {err}",
                    ))
                })?;
                tls.client_tls_config = Some(ClientTlsConfig {
                    client_cert: cert,
                    client_private_key: key,
                });
            }
            (None, None) => {}
            _ => {
                return Err(BridgeError::InvalidTlsConfig(
                    "client_cert/clientCert and client_private_key/clientPrivateKey must both be provided"
                        .to_string(),
                ));
            }
        }
    }

    if let Some(server_name) = server_name_override {
        if !server_name.is_empty() {
            tls.domain = Some(server_name);
        }
    }

    Ok(tls)
}

fn decode_base64(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    general_purpose::STANDARD.decode(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn extract_bearer_token_handles_case_insensitive_scheme() {
        assert_eq!(extract_bearer_token("Bearer abc"), Some("abc"));
        assert_eq!(extract_bearer_token("bearer  abc"), Some("abc"));
        assert_eq!(extract_bearer_token("Basic abc"), None);
        assert_eq!(extract_bearer_token("Bearer   "), None);
    }

    #[test]
    fn normalize_metadata_headers_lowercases_and_extracts_bearer() {
        let headers = HashMap::from([
            (
                String::from("Authorization"),
                String::from(" Bearer super-secret "),
            ),
            (String::from("X-Custom"), String::from(" value ")),
        ]);

        let (normalized, bearer) = normalize_metadata_headers(headers).expect("headers normalized");

        assert_eq!(normalized.get("x-custom"), Some(&"value".to_string()));
        assert!(!normalized.contains_key("authorization"));
        assert_eq!(bearer.as_deref(), Some("super-secret"));
    }
}
