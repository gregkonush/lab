use anyhow::{Context, Result, ensure};
use aws_lc_rs::{
    aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey},
    rand::{SecureRandom, SystemRandom},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;
use zeroize::Zeroizing;

/// Only the encrypted envelope is serializable. Key bytes and plaintext are never Debug values.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub key_id: String,
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

pub struct Vault {
    active: String,
    keys: BTreeMap<String, LessSafeKey>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyFile {
    active: String,
    keys: BTreeMap<String, String>,
}

impl Vault {
    pub fn active_key_id(&self) -> &str {
        &self.active
    }
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        let config: KeyFile = serde_json::from_slice(bytes).context("invalid vault key file")?;
        ensure!(
            !config.keys.is_empty() && config.keys.len() <= 8,
            "invalid key count"
        );
        let mut keys = BTreeMap::new();
        for (id, encoded) in config.keys {
            let encoded = Zeroizing::new(encoded);
            ensure!(!id.is_empty() && id.len() <= 64, "invalid key ID");
            let raw = Zeroizing::new(
                STANDARD
                    .decode(encoded.as_bytes())
                    .context("invalid vault key")?,
            );
            ensure!(raw.len() == 32, "vault key must contain 32 bytes");
            let key = UnboundKey::new(&AES_256_GCM, &raw)
                .map_err(|_| anyhow::anyhow!("invalid vault key"))?;
            keys.insert(id, LessSafeKey::new(key));
        }
        ensure!(
            keys.contains_key(&config.active),
            "active vault key is missing"
        );
        Ok(Self {
            active: config.active,
            keys,
        })
    }

    pub fn encrypt(
        &self,
        connection: Uuid,
        owner: &str,
        provider: &str,
        plaintext: &[u8],
    ) -> Result<Envelope> {
        ensure!(
            plaintext.len() <= 64 * 1024,
            "credential record is too large"
        );
        let mut nonce = [0; 12];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| anyhow::anyhow!("credential nonce unavailable"))?;
        let mut ciphertext = plaintext.to_vec();
        let aad = serde_json::to_vec(&(connection, owner, provider, &self.active))?;
        self.keys[&self.active]
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(aad),
                &mut ciphertext,
            )
            .map_err(|_| anyhow::anyhow!("credential encryption failed"))?;
        Ok(Envelope {
            key_id: self.active.clone(),
            nonce,
            ciphertext,
        })
    }

    pub fn decrypt(
        &self,
        connection: Uuid,
        owner: &str,
        provider: &str,
        envelope: &Envelope,
    ) -> Result<Zeroizing<Vec<u8>>> {
        ensure!(
            envelope.ciphertext.len() <= 64 * 1024 + 16,
            "credential record is too large"
        );
        let key = self
            .keys
            .get(&envelope.key_id)
            .context("credential encryption key is unavailable")?;
        let aad = serde_json::to_vec(&(connection, owner, provider, &envelope.key_id))?;
        let mut plaintext = Zeroizing::new(envelope.ciphertext.clone());
        let len = key
            .open_in_place(
                Nonce::assume_unique_for_key(envelope.nonce),
                Aad::from(aad),
                &mut plaintext,
            )
            .map_err(|_| anyhow::anyhow!("credential integrity check failed"))?
            .len();
        plaintext.truncate(len);
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vault() -> Vault {
        Vault::from_json(
            serde_json::to_string(
                &serde_json::json!({"active":"v1","keys":{"v1":STANDARD.encode([17;32])}}),
            )
            .unwrap()
            .as_bytes(),
        )
        .unwrap()
    }
    #[test]
    fn encryption_binds_account_provider_connection_and_key_and_uses_unique_nonces() {
        let vault = vault();
        let id = Uuid::new_v4();
        let first = vault
            .encrypt(id, "owner", "github", b"private-token")
            .unwrap();
        let second = vault
            .encrypt(id, "owner", "github", b"private-token")
            .unwrap();
        assert_ne!(first.nonce, second.nonce);
        assert!(!String::from_utf8_lossy(&first.ciphertext).contains("private-token"));
        assert_eq!(
            &**vault.decrypt(id, "owner", "github", &first).unwrap(),
            b"private-token"
        );
        for (id, owner, provider) in [
            (Uuid::new_v4(), "owner", "github"),
            (id, "other", "github"),
            (id, "owner", "slack"),
        ] {
            assert!(vault.decrypt(id, owner, provider, &first).is_err());
        }
        let mut bad = first.clone();
        bad.ciphertext[0] ^= 1;
        assert!(vault.decrypt(id, "owner", "github", &bad).is_err());
        bad = first;
        bad.key_id = "missing".into();
        assert!(vault.decrypt(id, "owner", "github", &bad).is_err());
    }
}
