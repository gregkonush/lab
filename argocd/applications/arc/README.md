# Github Actions Runners

These runners are specifically running on the `kube-worker-08` node.

- Chart version pinned in `application.yaml` is `0.12.1` for both the controller and the runner scale set.
- Upgrading from ≤0.9.x requires deleting the legacy `actions.github.com` CRDs and reinstalling the controller/runner charts before letting Argo CD reconcile.
- Keep the custom template (init container + privileged `docker:dind` sidecar with `DOCKER_HOST=unix:///var/run/docker.sock`) when reapplying so Docker builds continue to work under Kubernetes mode.
- Each runner pod now launches a Tailscale sidecar; create a secret `tailscale-auth` in the `arc` namespace with a reusable OAuth client secret (or auth key) before syncing:
  ```bash
  kubectl -n arc create secret generic tailscale-auth \
    --from-literal=TS_AUTHKEY=tskey-ephemeral-REPLACE_ME \
    --dry-run=client -o yaml | kubeseal --controller-namespace sealed-secrets --format yaml > argocd/applications/arc/tailscale-auth.yaml
  ```
  Replace the literal with a Tailscale OAuth client secret or an auth key that is permitted to issue ephemeral nodes (`?ephemeral=true` is appended automatically).

[Taint a node](../../kubernetes/README.md#tainting-a-node)
