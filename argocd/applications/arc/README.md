# Github Actions Runners

These runners are specifically running on the `kube-worker-08` node.

- Chart version pinned in `application.yaml` is `0.12.1` for both the controller and the runner scale set.
- Upgrading from ≤0.9.x requires deleting the legacy `actions.github.com` CRDs and reinstalling the controller/runner charts before letting Argo CD reconcile.
- Keep the custom template (init container + privileged `docker:dind` sidecar with `DOCKER_HOST=unix:///var/run/docker.sock`) when reapplying so Docker builds continue to work under Kubernetes mode.
- Tailscale connectivity now comes from the node-level installation managed by OpenTofu (`tofu/harvester/main.tf`) and Ansible (`ansible/playbooks/install_tailscale.yml`); no sidecar or additional secret is required in the runner pods.
- Generate the `github-token` SealedSecret with `scripts/generate-arc-github-token-secret.sh`. The script reads the token from 1Password via `${ARC_GITHUB_TOKEN_OP_PATH}` (defaults to `op://infra/github personal token/token`) and writes the sealed manifest to `argocd/applications/arc/github-token.yaml`.

[Taint a node](../../kubernetes/README.md#tainting-a-node)
