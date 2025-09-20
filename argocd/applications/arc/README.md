# Github Actions Runners

These runners are specifically running on the `kube-worker-08` node.

- Chart version pinned in `application.yaml` is `0.12.1` for both the controller and the runner scale set.
- Upgrading from ≤0.9.x requires deleting the legacy `actions.github.com` CRDs and reinstalling the controller/runner charts before letting Argo CD reconcile.
- Keep the custom template (init container + privileged `docker:dind` sidecar with `DOCKER_HOST=unix:///var/run/docker.sock`) when reapplying so Docker builds continue to work under Kubernetes mode.

[Taint a node](../../kubernetes/README.md#tainting-a-node)
