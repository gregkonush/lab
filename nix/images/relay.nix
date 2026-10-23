{
  pkgs,
  lib,
  repoRoot,
  repoRevision ? "dirty",
}:

let
  source = lib.fileset.toSource {
    root = repoRoot;
    fileset = lib.fileset.unions (
      map (relative: repoRoot + "/${relative}") [
        "services/relay/Cargo.toml"
        "services/relay/Cargo.lock"
        "services/relay/build.rs"
        "services/relay/catalog.example.json"
        "services/relay/src"
        "services/relay/migrations"
        "proto/proompteng/authz"
      ]
    );
  };
  relay = pkgs.rustPlatform.buildRustPackage {
    pname = "relay";
    version = "0.1.0";
    src = source;
    cargoRoot = "services/relay";
    buildAndTestSubdir = "services/relay";
    cargoLock.lockFile = repoRoot + "/services/relay/Cargo.lock";
    nativeBuildInputs = [
      pkgs.cmake
      pkgs.protobuf
    ];
    PROTOC = "${pkgs.protobuf}/bin/protoc";
  };
in
pkgs.dockerTools.buildLayeredImage {
  name = "registry.ide-newton.ts.net/lab/relay";
  tag = "nix";
  contents = [
    relay
    pkgs.cacert
  ];
  config = {
    Entrypoint = [ "${relay}/bin/relay" ];
    Cmd = [ "serve" ];
    User = "65532:65532";
    Env = [
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      "APP_SOURCE_REVISION=${repoRevision}"
    ];
    ExposedPorts."8443/tcp" = { };
    ExposedPorts."8080/tcp" = { };
    Labels = {
      "org.opencontainers.image.source" = "https://github.com/proompteng/lab";
      "org.opencontainers.image.revision" = repoRevision;
    };
  };
}
