{
  pkgs,
  lib,
  repoRoot,
  repoRevision ? "dirty",
  bun,
  nodejs,
}:

let
  imageRepository = "registry.ide-newton.ts.net/lab/bayn";
  # SHA-256 identity for bayn.jev.continuous-markets.behavior.v1, verified by the production executable.
  strategyBehaviorHash = "420011c3d2552eaf702adadc67ecb8441bf320bdea89aad090dd0ad243b528e0";
  # Canonical hash of the compiled bayn.jev.protocol.v3 document.
  strategyParameterHash = "d97d393a316dd769857752321bd6951d3e7e7efad2df97523e585efe07625ca3";
  strategyName = "jev";
  # Canonical bayn.strategy-protocol.v1 identity: name, behavior, parameters, and parameter schema.
  strategyProtocolHash = "1d91d5148c8bedc5631c21881975af5be8db334826eb143335d4c7a663e0d394";
  # Canonical increased sandbox policy for the build-contract sentinel, without embedding a broker account identity.
  # This records availability; runtime separately selects and verifies the account-bound activation policy.
  executionRiskPolicyHash = "3374cc844630d2aa17ecff44abe77c8194fa549a06819b71a537fa37508e6a93";
  forwardPerformanceCommand = pkgs.writeShellScriptBin "bayn-forward-performance" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/forward-performance-command.js" "$@"
  '';
  backtestCommand = pkgs.writeShellScriptBin "bayn-backtest" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/backtest-command.js" "$@"
  '';
  controlStudyCommand = pkgs.writeShellScriptBin "bayn-control-study" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/control-study-command.js" "$@"
  '';
  jevStudyExportCommand = pkgs.writeShellScriptBin "bayn-jev-study-export" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/jev-study-export-command.js" "$@"
  '';
  inferenceCostCommand = pkgs.writeShellScriptBin "bayn-inference-cost" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/inference-cost-command.js" "$@"
  '';
  gapRecoveryCommand = pkgs.writeShellScriptBin "bayn-gap-recovery" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/gap-recovery-command.js" "$@"
  '';
  ridgeTrainingCommand = pkgs.writeShellScriptBin "bayn-ridge-training" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/ridge-training-command.js" "$@"
  '';
  researchCommand = pkgs.writeShellScriptBin "bayn-research" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/research-command.js" "$@"
  '';
  buildDefine = name: value: "--define ${name}=${lib.escapeShellArg (builtins.toJSON value)}";
  dependencySource = import ./bun-workspace-deps-source.nix { inherit lib repoRoot; };
  depsHash = {
    x86_64-linux = "sha256-V3hT0BNmtio0O9VkMpG++a4pOd+/z9kYmfeQPVqtK4s=";
    aarch64-linux = "sha256-fZdAwOSNSRrN9QZZrtIoXSc0kf/hunKzoVgsWpHwLrU=";
  };
  buildCommands = [
    "bun --cwd=services/bayn run tsc"
    (
      "bun --cwd=services/bayn build src/index.ts src/verify-build-contract.ts src/forward-performance-command.ts src/inference-cost-command.ts src/jev-study-export-command.ts src/backtest-command.ts src/control-study-command.ts src/gap-recovery-command.ts src/ridge-training-command.ts src/streaming-diagnostics-command.ts src/restate/restate-execution-server.ts src/restate/restate-execution-activate.ts src/restate/restate-research-server.ts src/research-command.ts src/valkey-command.ts --target=node "
      + "--external tigerbeetle-node --external @platformatic/kafka --entry-naming '[name].js' --outdir=dist "
      + buildDefine "__BAYN_BUILD_SOURCE_REVISION__" repoRevision
      + " "
      + buildDefine "__BAYN_BUILD_IMAGE_REPOSITORY__" imageRepository
      + " "
      + buildDefine "__BAYN_BUILD_STRATEGY_BEHAVIOR_HASH__" strategyBehaviorHash
      + " "
      + buildDefine "__BAYN_BUILD_STRATEGY_PARAMETER_HASH__" strategyParameterHash
      + " "
      + buildDefine "__BAYN_BUILD_STRATEGY_NAME__" strategyName
      + " "
      + buildDefine "__BAYN_BUILD_STRATEGY_PROTOCOL_HASH__" strategyProtocolHash
      + " "
      + buildDefine "__BAYN_BUILD_EXECUTION_RISK_POLICY_HASH__" executionRiskPolicyHash
    )
    "node services/bayn/dist/verify-build-contract.js"
    "node services/bayn/dist/gap-recovery-command.js --help"
    "node services/bayn/dist/ridge-training-command.js --help"
    "node services/bayn/dist/control-study-command.js --help"
    "node services/bayn/dist/jev-study-export-command.js --help"
    "node services/bayn/dist/research-command.js --help"
    "node services/bayn/dist/valkey-command.js --help"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/forward-performance-command.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/backtest-command.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-execution-server.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-execution-activate.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-research-server.js"
    "grep -F -- ${lib.escapeShellArg strategyBehaviorHash} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg strategyParameterHash} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg strategyName} services/bayn/dist/verify-build-contract.js"
    "grep -F -- ${lib.escapeShellArg strategyProtocolHash} services/bayn/dist/verify-build-contract.js"
    "grep -F -- ${lib.escapeShellArg executionRiskPolicyHash} services/bayn/dist/verify-build-contract.js"
  ];
  runtimeInstallPhase = ''
    mkdir -p "$out/app/services/bayn/dist"
    cp "$TMPDIR/work/services/bayn/dist/index.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/forward-performance-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/inference-cost-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/backtest-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/control-study-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/jev-study-export-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/gap-recovery-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/ridge-training-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/streaming-diagnostics-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/restate-execution-server.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/restate-execution-activate.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/restate-research-server.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/valkey-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/research-command.js" "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/package.json" "$out/app/services/bayn/package.json"
    node "$TMPDIR/work/services/bayn/scripts/copy-runtime-dependencies.mjs" \
      "$TMPDIR/work/services/bayn" "$out/app/services/bayn"
  '';
  runtimeRoot = import ./bayn-runtime-root.nix {
    inherit
      pkgs
      lib
      repoRoot
      dependencySource
      depsHash
      bun
      nodejs
      buildCommands
      runtimeInstallPhase
      ;
  };
in
import ./bun-workspace-service.nix {
  inherit
    pkgs
    lib
    bun
    nodejs
    depsHash
    runtimeRoot
    ;
  repoRoot = dependencySource;
  serviceName = "bayn";
  packageName = "@proompteng/bayn";
  # Bayn's fixed-output dependency closure is intentionally isolated from TypeScript source-tree topology.
  # Refreshed once after dependencySource became a manifest/lock/patch-only file set. Source-only tree changes
  # can no longer perturb these architecture-specific dependency outputs.
  installFilters = [
    "@proompteng/bayn"
  ];
  sourcePaths = [ ];
  command = [
    "node"
    "dist/index.js"
  ];
  workingDir = "/app/services/bayn";
  includeBunRuntime = false;
  extraContents = [
    nodejs
    pkgs.cacert
    forwardPerformanceCommand
    inferenceCostCommand
    researchCommand
    backtestCommand
    controlStudyCommand
    jevStudyExportCommand
    gapRecoveryCommand
    ridgeTrainingCommand
  ];
  exposedPorts = {
    "8080/tcp" = { };
    "9080/tcp" = { };
  };
  labels = {
    "org.opencontainers.image.revision" = repoRevision;
    "proompteng.ai/bayn.strategy-behavior-hash" = strategyBehaviorHash;
    "proompteng.ai/bayn.strategy-parameter-hash" = strategyParameterHash;
    "proompteng.ai/bayn.strategy-name" = strategyName;
    "proompteng.ai/bayn.strategy-protocol-hash" = strategyProtocolHash;
    "proompteng.ai/bayn.execution-risk-policy-hash" = executionRiskPolicyHash;
  };
}
