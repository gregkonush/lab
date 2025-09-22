# Github Actions Runners

These runners are specifically running on the `kube-worker-08` node.

- Chart version pinned in `application.yaml` is `0.12.1` for both the controller and the runner scale set.
- Upgrading from ≤0.9.x requires deleting the legacy `actions.github.com` CRDs and reinstalling the controller/runner charts before letting Argo CD reconcile.
- Keep the custom template (init container + privileged `docker:dind` sidecar with `DOCKER_HOST=unix:///var/run/docker.sock`) when reapplying so Docker builds continue to work under Kubernetes mode.
- Each runner pod now launches a Tailscale sidecar; generate the `tailscale-auth` SealedSecret with `scripts/generate-arc-tailscale-auth-secret.sh`. The script reads the auth key from 1Password via `${ARC_TAILSCALE_AUTHKEY_OP_PATH}` (defaults to `op://infra/tailscale auth key/authkey`) and writes the sealed manifest to `argocd/applications/arc/tailscale-auth.yaml`. The sealed secret must contain a key named `TS_AUTHKEY` that issues ephemeral nodes (`?ephemeral=true` is added automatically by the sidecar).
- Generate the `github-token` SealedSecret with `scripts/generate-arc-github-token-secret.sh`. The script reads the token from 1Password via `${ARC_GITHUB_TOKEN_OP_PATH}` (defaults to `op://infra/github personal token/token`) and writes the sealed manifest to `argocd/applications/arc/github-token.yaml`.

[Taint a node](../../kubernetes/README.md#tainting-a-node)
