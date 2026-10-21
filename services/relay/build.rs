fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto = "../../proto/proompteng/authz/v1/authz.proto";
    tonic_prost_build::configure()
        .build_server(false)
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .field_attribute(
            ".proompteng.authz.v1.ObservationScope.connector_operations",
            "#[serde(default)]",
        )
        .field_attribute(
            ".proompteng.authz.v1.ObservationScope.connector_runtime_epoch",
            "#[serde(default)]",
        )
        .compile_protos(&[proto], &["../../proto"])?;
    println!("cargo:rerun-if-changed={proto}");
    Ok(())
}
