pub mod catalog;
pub mod crypto;
pub mod network;
pub mod oauth;
pub mod policy;
pub mod service;
pub mod store;
pub mod upstream;

pub mod authz_proto {
    tonic::include_proto!("proompteng.authz.v1");
}

#[cfg(test)]
mod integration;
