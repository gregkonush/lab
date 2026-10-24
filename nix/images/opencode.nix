{ pkgs, lib, repoRoot, repoRevision ? "dirty", bun, nodejs, ciToolchain }:
let
  cli = import ./opencode-cli.nix { inherit pkgs lib; };
  dependencySource = import ./bun-workspace-deps-source.nix { inherit lib repoRoot; };
  depsHash = import ./bayn-deps-hash.nix;
  researchRoot = import ./bayn-runtime-root.nix {
    inherit pkgs lib repoRoot dependencySource depsHash bun nodejs;
    buildCommands = [
      "bun build services/bayn/src/opencode-command.ts --target=node --format=esm --packages=bundle --outfile=research.js"
    ];
    runtimeInstallPhase = ''
      mkdir -p "$out/app/opencode" "$out/usr/bin"
    ln -s ${pkgs.coreutils}/bin/env "$out/usr/bin/env"
      cp "$TMPDIR/work/research.js" "$out/app/opencode/research.js"
      printf '{"type":"module"}\n' > "$out/app/opencode/package.json"
    '';
  };
  tools = pkgs.buildEnv {
    name = "opencode-development-tools";
    paths = [ ciToolchain cli nodejs bun pkgs.bashInteractive pkgs.openssh pkgs.gnutar pkgs.gzip pkgs.unzip pkgs.sqlite pkgs.tini pkgs.stdenv.cc pkgs.cmake pkgs.rustc pkgs.cargo ];
    pathsToLink = [ "/bin" ];
    ignoreCollisions = true;
  };
  start = pkgs.writeShellScriptBin "opencode-server" (builtins.readFile (repoRoot + "/services/opencode/start.sh"));
  root = pkgs.runCommand "opencode-root" { } ''
    mkdir -p "$out/app/opencode" "$out/usr/bin"
    ln -s ${pkgs.coreutils}/bin/env "$out/usr/bin/env"
    cp ${repoRoot}/services/opencode/migrate_state.py "$out/app/opencode/migrate_state.py"
    mkdir -p "$out/etc" "$out/tmp" "$out/workspace" "$out/var/lib/opencode"
    chmod 1777 "$out/tmp"
    printf 'opencode:x:65532:65532:OpenCode:/var/lib/opencode:/bin/bash\n' > "$out/etc/passwd"
    printf 'opencode:x:65532:\n' > "$out/etc/group"
  '';
in pkgs.dockerTools.buildLayeredImage {
  name = "opencode";
  tag = "latest";
  maxLayers = 64;
  contents = [ tools start researchRoot root pkgs.cacert ];
  config = {
    User = "65532:65532";
    WorkingDir = "/workspace";
    Entrypoint = [ "${pkgs.tini}/bin/tini" "--" ];
    Cmd = [ "${start}/bin/opencode-server" ];
    Env = [
      "PATH=${tools}/bin:/bin"
      "HOME=/var/lib/opencode"
      "XDG_DATA_HOME=/var/lib/opencode/data"
      "XDG_CONFIG_HOME=/var/lib/opencode/config"
      "XDG_STATE_HOME=/var/lib/opencode/state"
      "XDG_CACHE_HOME=/var/lib/opencode/cache"
      "TMPDIR=/tmp"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      "OPENCODE_CODE_REVISION=${repoRevision}"
    ];
    ExposedPorts."4096/tcp" = { };
    Labels."org.opencontainers.image.revision" = repoRevision;
  };
}
