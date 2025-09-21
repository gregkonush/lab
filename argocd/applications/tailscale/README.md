# Tailscale Operator Secrets

Use `scripts/generate-tailscale-sealed-secret.sh` after installing the Tailscale operator to refresh the OAuth client credentials managed by Sealed Secrets. The script:

1. Reads `client_id` and `client_secret` from 1Password via the CLI (`op`).
2. Generates a plain Kubernetes `Secret` and pipes it through `kubeseal` using the controller in the `sealed-secrets` namespace.
3. Overwrites `argocd/applications/tailscale/base/secrets.yaml`; add `--apply` if you also want it pushed to the active cluster.

## Prerequisites

- Logged in to the 1Password CLI (`op`).
- `kubectl` context pointing at the cluster where Sealed Secrets is installed.
- `kubeseal` CLI installed.

## Usage

```bash
# Optional: override default 1Password item paths
export TAILSCALE_OP_CLIENT_ID_PATH="op://infra/tailscale operator/client_id"
export TAILSCALE_OP_CLIENT_SECRET_PATH="op://infra/tailscale operator/client_secret"

# Optional: override controller name/namespace if they differ
export TAILSCALE_SEALED_CONTROLLER_NAME=sealed-secrets
export TAILSCALE_SEALED_CONTROLLER_NAMESPACE=sealed-secrets

# Regenerate the sealed secret (writes to argocd/applications/tailscale/base/secrets.yaml)
./scripts/generate-tailscale-sealed-secret.sh

# Regenerate and apply to the current cluster
./scripts/generate-tailscale-sealed-secret.sh --apply
```

Pass a custom output path as the first argument if you want to write the sealed secret elsewhere for inspection before committing:

```bash
./scripts/generate-tailscale-sealed-secret.sh /tmp/tailscale-sealed-secret.yaml

# Write to /tmp and apply to the cluster
./scripts/generate-tailscale-sealed-secret.sh --apply /tmp/tailscale-sealed-secret.yaml
```

After committing the refreshed `secrets.yaml`, Argo CD will reconcile the new credentials automatically.
