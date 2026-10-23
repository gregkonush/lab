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
  # SHA-256 identity for bayn.jev.market-anchored-economic-plan.behavior.v1, verified by the production executable.
  strategyBehaviorHash = "8669593548424d848e8bcd2157eec5e571e9f7595315c9aea0c0ab56e214fc3b";
  # Canonical hash of the compiled bayn.jev.protocol.v18 document.
  strategyParameterHash = "167b5258319906743909ed89d6bb8fec7a01e4a134825cc64aa30d65a229f3be";
  strategyName = "jev";
  # Canonical bayn.strategy-protocol.v1 identity: name, behavior, parameters, and parameter schema.
  strategyProtocolHash = "03d49555af1590514bd756099f8da95495faad7645a00b4081532edf4bf0793a";
  # Canonical increased sandbox policy for the build-contract sentinel, without embedding a broker account identity.
  # This records availability; runtime separately selects and verifies the account-bound activation policy.
  executionRiskPolicyHash = "5f0e0cd4aa5ee11556bede5ab9a6286744b589ef08efe2d1f8accbb30e63eeab";
  forwardPerformanceCommand = pkgs.writeShellScriptBin "bayn-forward-performance" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/forward-performance-command.js" "$@"
  '';
  inferenceCostCommand = pkgs.writeShellScriptBin "bayn-inference-cost" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/inference-cost-command.js" "$@"
  '';
  researchCommand = pkgs.writeShellScriptBin "bayn-research" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/research-command.js" "$@"
  '';
  evaluationCommand = pkgs.writeShellScriptBin "bayn-jev-evaluate" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/jev-evaluation-command.js" "$@"
  '';
  dualSignalCommand = pkgs.writeShellScriptBin "bayn-dual-signal" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/dual-signal-command.js" "$@"
  '';
  backtestCommand = pkgs.writeShellScriptBin "bayn-backtest" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/backtest-command.js" "$@"
  '';
  controlCommand = pkgs.writeShellScriptBin "bayn-control-study" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    exec "$root/bin/node" "$root/app/services/bayn/dist/control-study-command.js" "$@"
  '';
  gepaPython = pkgs.python312.withPackages (ps: [
    ps.boto3
    (ps.buildPythonPackage {
      pname = "gepa";
      version = "0.1.4";
      pyproject = true;
      src = pkgs.fetchurl {
        url = "https://github.com/gepa-ai/gepa/archive/8f287de942f41a6d1e0e7e5b2d576247c4bedee9.tar.gz";
        hash = "sha256-9OiI0NGMGhPYoUw4KPhZYZd+oAG9qLyr0TkdkY3oDDM=";
      };
      build-system = [ ps.setuptools ps.wheel ps.build ];
      pythonImportsCheck = [ "gepa.optimize_anything" ];
      doCheck = false;
    })
  ]);
  gepaCommand = pkgs.writeShellScriptBin "bayn-gepa" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    export PATH="$root/bin:$PATH"
    exec ${gepaPython}/bin/python "$root/app/services/bayn/gepa/runner.py" "$@"
  '';
  gepaNativeCommand = pkgs.writeShellScriptBin "bayn-gepa-native" ''
    set -eu
    root="''${BAYN_IMAGE_ROOT:-}"
    export PATH="$root/bin:$PATH"
    exec ${gepaPython}/bin/python "$root/app/services/bayn/gepa/native.py" "$@"
  '';
  buildDefine = name: value: "--define ${name}=${lib.escapeShellArg (builtins.toJSON value)}";
  buildDefines = lib.concatStringsSep " " [
    (buildDefine "__BAYN_BUILD_SOURCE_REVISION__" repoRevision)
    (buildDefine "__BAYN_BUILD_IMAGE_REPOSITORY__" imageRepository)
    (buildDefine "__BAYN_BUILD_STRATEGY_BEHAVIOR_HASH__" strategyBehaviorHash)
    (buildDefine "__BAYN_BUILD_STRATEGY_PARAMETER_HASH__" strategyParameterHash)
    (buildDefine "__BAYN_BUILD_STRATEGY_NAME__" strategyName)
    (buildDefine "__BAYN_BUILD_STRATEGY_PROTOCOL_HASH__" strategyProtocolHash)
    (buildDefine "__BAYN_BUILD_EXECUTION_RISK_POLICY_HASH__" executionRiskPolicyHash)
  ];
  dependencySource = import ./bun-workspace-deps-source.nix { inherit lib repoRoot; };
  depsHash = {
    x86_64-linux = "sha256-TY+rJMR1vTCP84/kFDIRPurtGaCepT6lGy4Zjkx9ouA=";
    aarch64-linux = "sha256-CqZAxmjpRsJYuztoHliGnPJQCX0GuiMGH9NiZIR5H+E=";
  };
  buildCommands = [
    "bun --cwd=services/bayn run tsc"
    "bun --cwd=services/bayn run build ${buildDefines}"
    "bun services/bayn/tools/record-jev-compiler-dependencies.ts --output services/bayn/dist/backtest-command.js --source ${lib.escapeShellArg repoRevision} ${buildDefines}"
    "node services/bayn/dist/verify-build-contract.js"
    "node services/bayn/dist/research-command.js --help"
    "node services/bayn/dist/jev-evaluation-command.js --help"
    "node services/bayn/dist/dual-signal-command.js --help"
    "node services/bayn/dist/backtest-command.js --help"
    "node services/bayn/dist/control-study-command.js --help"
    "node services/bayn/dist/valkey-command.js --help"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/forward-performance-command.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-execution-server.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-execution-activate.js"
    "grep -F -- ${lib.escapeShellArg repoRevision} services/bayn/dist/restate-research-server.js"
    "grep -F -- ${lib.escapeShellArg strategyBehaviorHash} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg strategyParameterHash} services/bayn/dist/index.js"
    "grep -F -- ${lib.escapeShellArg strategyName} services/bayn/dist/verify-build-contract.js"
    "grep -F -- ${lib.escapeShellArg strategyProtocolHash} services/bayn/dist/verify-build-contract.js"
    "grep -F -- ${lib.escapeShellArg executionRiskPolicyHash} services/bayn/dist/verify-build-contract.js"
    "rm services/bayn/dist/verify-build-contract.js"
  ];
  runtimeInstallPhase = ''
    mkdir -p "$out/app/services/bayn/dist"
    cp "$TMPDIR/work/services/bayn/dist/"*.js "$out/app/services/bayn/dist/"
    cp "$TMPDIR/work/services/bayn/dist/jev-compiler-dependencies.json" "$out/app/services/bayn/dist/jev-compiler-dependencies.json"
    cp "$TMPDIR/work/services/bayn/package.json" "$out/app/services/bayn/package.json"
    mkdir -p "$out/app/services/bayn/gepa"
    cp "$TMPDIR/work/services/bayn/gepa/runner.py" "$TMPDIR/work/services/bayn/gepa/native.py" "$out/app/services/bayn/gepa/"
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
    gepaCommand
    gepaNativeCommand
    bun
    pkgs.git
    evaluationCommand
    dualSignalCommand
    backtestCommand
    controlCommand
    gepaPython
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
