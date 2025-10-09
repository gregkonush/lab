# Coder Workspace Bootstrap Runbook

This document explains how to maintain the single `k8s-arm64` template, push new versions, and verify the tool bootstrap succeeds so that follow-up Codex runs can iterate reliably.

## Prerequisites

- Logged in to the Coder deployment (`coder login ...`).
- `coder` CLI v2.26.0 or newer on your local machine.
- Repository cloned locally (this repo, default path `~/github.com/lab`).

## Template Update Loop

1. Edit `kubernetes/coder/main.tf` and `kubernetes/coder/template.yaml` as needed.
2. Bump `version` in `kubernetes/coder/template.yaml` (e.g., `1.0.8`).
3. Push a new template version:
   ```bash
   coder templates push k8s-arm64 --directory kubernetes/coder --message 'feat: describe change' --yes
   ```
4. Confirm only one template exists:
   ```bash
   coder templates list
   ```
   If an extra template appears (e.g., `coder`), delete it:
   ```bash
   coder templates delete <template-name> --yes
   ```

## Workspace Recreation

1. Delete the old workspace before recreating:
   ```bash
   coder delete greg/proompteng --yes
   ```
2. Recreate it using the latest version (automatically active after push):
   ```bash
   coder create greg/proompteng \
     --template k8s-arm64 \
     --parameter cpu=4 \
     --parameter memory=8 \
     --parameter home_disk_size=30 \
     --parameter repository_url=https://github.com/gregkonush/lab \
     --parameter repository_directory=/home/coder/github.com \
     --yes
   ```
   The CLI is interactive by default; pass `--yes` and explicit `--parameter` values or it will block waiting for input. Use an absolute workspace path (for example `/home/coder/github.com`) to avoid your local shell expanding `~` before it reaches Coder.
3. Wait for the workspace to provision. Use `coder list` to watch status.

## Bootstrap Script Overview

- Waits up to three minutes for `module.nodejs` to finish publishing `~/.nvm/nvm.sh` and Node 22. If the module misses that window, the script installs `nvm` and Node 22 itself.
- After `nvm use 22`, the script refreshes the shell hash table and blocks until `npm` is reachable to avoid race conditions that previously produced exit code 127.
- Corepack is preferred for `pnpm` activation; if it never becomes available the script logs the fallback and installs `pnpm` with `npm install -g pnpm`.
- Installs CLI dependencies in this order: `pnpm`, `convex@1.27.0`, `@openai/codex`, `kubectl`, `argocd`.
- Appends `PNPM_HOME` and `~/.local/bin` to the login shells (`.profile`, `.bashrc`, `.zshrc`) so future shells inherit the toolchain.
- Dependency install runs only when a manifest exists: `pnpm install --frozen-lockfile` if the repo has a `pnpm-lock.yaml`, otherwise `npm install` when only `package.json` is present.

## Inspecting Bootstrap Logs

- Primary log directory: `/tmp/coder-bootstrap` (created by the bootstrap script).
- Agent logs:
  - `/tmp/coder-startup-script.log`
  - `/tmp/coder-agent.log`
  - `/tmp/coder-script-*.log`

Connect without waiting for scripts to finish so you can inspect logs while the bootstrap runs:

```bash
coder ssh greg/proompteng.main --wait=no
```

## Verifying Installed Tools

Run these checks inside the workspace to ensure bootstrap success:

```bash
node --version
npm --version
pnpm --version
codex --version
convex --version
kubectl version --client
argocd version --client
```

If a command is missing, re-run the bootstrap script manually for quicker iteration:

```bash
bash -x /tmp/coder-script-data/bin/bootstrap_tools
```

## Syncing Codex CLI Authentication

Codex sessions are stored locally under `~/.codex/auth.json`. When recreating the `proompteng` workspace you need to push that file into the remote home directory so CLI calls succeed without re-authenticating.

1. Make sure your local machine has an SSH host entry for each workspace:
   ```bash
   coder config-ssh --yes
   ```
   This creates aliases such as `coder.proompteng` that wrap the Coder proxy command.
2. Sync the Codex CLI credentials and config:
   ```bash
   ./scripts/sync-codex-cli.sh
   ```
   - Optional flags: `--workspace <name>`, `--auth <path>`, `--config <path>`, `--remote-home <path>`, `--remote-repo <path>`.
     - The script checks for both `rsync` and the OpenSSH client locally and will exit early if either is missing.
   - By default the script consumes `scripts/codex-config-template.toml` (no MCP stanza) and renders it for the remote paths, so `/home/coder` and `/home/coder/github.com/lab` remain trusted on Ubuntu. Supply `--config <path>` if you need a different template.
   - After syncing it installs a shell wrapper function in `~/.profile`, `~/.bashrc`, and `~/.zshrc` so running `codex …` automatically expands to `codex --dangerously-bypass-approvals-and-sandbox --search --model gpt-5-codex …` without shadowing the binary.
   - Both files are locked down with `chmod 600` after transfer.
3. Verify on the remote host if desired:
   ```bash
   ssh coder.proompteng 'ls -l ~/.codex/auth.json'
   ```

If you skip step 1 the script fails fast with: `SSH host entry 'coder.<workspace>' not found. Run 'coder config-ssh --yes' to configure SSH access.`

## Debug Tips

- Exit code 127 usually means a command was not found. Ensure PATH exports in the bootstrap script include `$HOME/.local/bin` and `$HOME/.local/share/pnpm` before using the tool.
- Every installation step writes detailed logs under `/tmp/coder-bootstrap/*.log`. Review these before editing the script.
- For Node tooling, confirm `nvm` sourced correctly by checking `~/.nvm/nvm.sh` and the default alias (`nvm current`).
- Use `coder templates versions list k8s-arm64` to make sure the expected version is active.

## Research References

- Coder troubleshooting guide: https://coder.com/docs/admin/templates/troubleshooting
  - Covers non-blocking startup scripts, logging locations, and interpreting agent errors.

Following this loop keeps the template lineage clean and ensures future Codex runs can pick up where you leave off.

## Latest Findings (September 28, 2025)

- Bootstrap script v1.0.17 now tolerates the node module’s nested `~/.nvm/nvm` layout, waits for Node 22, and re-installs nvm if the module lags.
- Tooling validated inside `greg/proompteng` on template version `xenodochial_jackson9` (Node v22.20.0, pnpm 10.18.1, Convex 1.27.0, codex-cli 0.42.0, kubectl v1.34.1, Argo CD v3.1.7).
- Repository auto-detection fixes the previous `/home/coder/github.com/workspace` miss; `pnpm install --frozen-lockfile` now runs automatically when `pnpm-lock.yaml` is present.
- `kubectl` and `argocd` binaries are symlinked into `/tmp/coder-script-data/bin`, so `coder ssh workspace -- <command>` works without shell init files.
