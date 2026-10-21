use anyhow::{Context, Result, ensure};
use futures::StreamExt;
use reqwest::{Client, Response};
use std::{collections::BTreeMap, net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::Mutex;

use crate::catalog::{endpoint, public_ip};

pub const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Default)]
pub struct Network {
    clients: Arc<Mutex<BTreeMap<String, Client>>>,
    #[cfg(test)]
    pub fixture: Option<(SocketAddr, reqwest::Certificate)>,
}

impl Network {
    /// DNS is checked on every dispatch. Reuse only clients pinned to the same checked address set.
    pub async fn client(&self, raw: &str) -> Result<Client> {
        let url = endpoint(raw)?;
        let host = url.host_str().context("missing provider hostname")?;
        #[cfg(test)]
        if let Some((address, certificate)) = &self.fixture {
            return Ok(Client::builder()
                .user_agent(concat!("Relay/", env!("CARGO_PKG_VERSION")))
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .add_root_certificate(certificate.clone())
                .resolve_to_addrs(host, &[*address])
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(20))
                .build()?);
        }
        let mut addresses: Vec<SocketAddr> =
            tokio::time::timeout(Duration::from_secs(3), tokio::net::lookup_host((host, 443)))
                .await??
                .filter(|address| address.is_ipv4())
                .collect();
        ensure!(
            !addresses.is_empty() && addresses.iter().all(|a| public_ip(a.ip())),
            "provider resolved to a protected destination"
        );
        addresses.sort();
        addresses.dedup();
        let key = format!("{host}:{addresses:?}");
        let mut clients = self.clients.lock().await;
        if let Some(client) = clients.get(&key) {
            return Ok(client.clone());
        }
        let client = Client::builder()
            .user_agent(concat!("Relay/", env!("CARGO_PKG_VERSION")))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(host, &addresses)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(25))
            .pool_idle_timeout(Duration::from_secs(30))
            .build()?;
        if clients.len() >= 256 {
            clients.clear();
        }
        clients.insert(key, client.clone());
        Ok(client)
    }
}

pub async fn body(response: Response, limit: usize) -> Result<Vec<u8>> {
    ensure!(response.status().is_success(), "provider request failed");
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(
            bytes.len() + chunk.len() <= limit,
            "provider response exceeded its byte budget"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
