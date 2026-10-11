# Github Actions Runners

ARC separates architecture-specific runner pods from architecture-neutral control-plane pods.

- Chart version pinned in `application.yaml` is `0.14.2` for both the controller and the runner scale set.
- The custom image pins Actions runner `2.337.0` in `nix/images/arc-runner.nix`, independently of the ARC chart version.
  Update its upstream index digest and both platform archive hashes together. Confirm the repository's accepted
  runner version with `gh api repos/proompteng/lab/actions/runners/downloads`, then verify `Runner.Listener --version`
  in the delivered runner. Restarting the controller does not update that binary.
- The architecture-neutral controller and listener pods run on AMD64 capacity; runner pods retain their scale set's
  explicit AMD64 or ARM64 selector.
- Upgrading from ≤0.9.x requires deleting the legacy `actions.github.com` CRDs and reinstalling the controller/runner charts before letting Argo CD reconcile.
- Keep the custom template (init container + privileged `docker:dind` sidecar with `DOCKER_HOST=unix:///var/run/docker.sock`) when reapplying so Docker builds continue to work under Kubernetes mode.
- The runner container intentionally waits for `docker version` before starting `run.sh`; without this guard, ARC can register a runner before the dind socket is ready.
- The `arc-amd64` runner is pinned to Ryzen, `talos-192-168-1-194`, and uses one 45Gi generic ephemeral
  PVC on `local-path-ryzen`. Its `/nix`, `/home/runner/.cache`, `/tmp`, shared `/home/runner/_work`, and Docker data
  subpaths live on the existing 1.8TB XFS user volume at `/var/mnt/local-path-provisioner`. The init container copies
  the image's `/nix` tree before the main containers mount the scratch subpath, verifies the filesystem, free capacity,
  regular-file byte count, regular-file count, and symlink count, then fails closed on any mismatch.
  The PVC is deleted with the runner Pod. ARM64 and `analysis-arm64` retain their existing `emptyDir` workspaces on ARM64.
- The 45Gi value is a PVC request. The local-path provisioner does not configure an XFS project quota, so Kubernetes
  does not enforce a 45Gi per-runner ceiling. The init requires at least 45Gi free after copying the image tree and
  cache. A failed scratch bootstrap is a runner admission failure; investigate it before changing the class.
- Ryzen's local partition shares a physical NVMe with Talos `/var`. Moving builds frees Turin's scratch device and
  avoids Ceph-volume traffic from Ryzen, but does not prove isolation from Ryzen's etcd or control-plane I/O.
- DinD mounts separate root-owned scratch subpaths at `/var/lib/docker` and `/var/lib/containerd`, covering both the
  daemon data root and the containerd image store. The runner's Nix store and cache remain owned by UID 1001. Validate
  `/var` I/O under the actual workload before resuming storage maintenance or increasing build capacity further.
- The AMD64 scratch init requests 2Gi and is limited to 8Gi of memory. Its full Nix-tree bootstrap exceeded the prior
  512Mi limit and was OOM-killed before the runner could register. This stays within the Pod's existing 16Gi aggregate
  memory request for runner and DinD, so the init does not increase its scheduling reservation.
- Tailscale connectivity comes from the Omni-owned node configuration in
  `devices/galactic/omni/cluster-template.yaml`; no sidecar or additional secret is required in the runner pods. Follow
  `devices/galactic/omni/README.md` for changes. The retained Harvester/Ansible fleet configuration is not current Talos
  ownership.
- ARC runner and listener pods append the tailnet search suffix `ide-newton.ts.net` via `dnsConfig.searches`, so bare tailnet hosts such as `temporal-grpc` resolve from GitHub Actions jobs without hardcoding the full `*.ts.net` name.
- Generate the `github-token` SealedSecret with `scripts/generate-arc-github-token-secret.sh`. The script reads the token from 1Password via `${ARC_GITHUB_TOKEN_OP_PATH}` (defaults to `op://infra/github personal token/token`) and writes the sealed manifest to `argocd/applications/arc/github-token.yaml`.

## AMD64 capacity

The `arc-amd64` scale set uses `minRunners: 1` and `maxRunners: 2`. Each runner reserves 16Gi across the runner and DinD.
Ryzen has about 61.8Gi allocatable despite its 128GB physical RAM. On 2026-10-11, non-Ceph workloads reserved about
25.8Gi. Two runners add 32Gi, leaving about 4Gi for request headroom after the Ceph clients move away. Three runners
would exceed allocatable memory. Recheck requests and actual concurrent-build usage before raising the cap.

Apply the new local class and complete the [Ryzen placement rollout](../../../devices/galactic/scheduling/README.md)
before promoting the runner configuration through Kargo. Existing busy runners must finish normally.
The compute-local toleration is explicit in the runner template so startup does not depend on admission mutation.
The ARM64 scale sets retain their existing placement and capacity.

Capacity changes use a reviewed Git change and the normal runner-image/Kargo delivery path. If storage contention
returns, restore `minRunners: 0` and `maxRunners: 1` through that path. Existing busy runners finish before the count
falls; the [ARC controller](https://github.com/actions/actions-runner-controller/blob/master/docs/gha-runner-scale-set-controller/README.md)
checks with the Actions service before deleting a runner. Do not delete runner Pods manually.

GitHub's [official ARC scale-set documentation](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/deploy-runner-scale-sets#example-jobs-queue-draining)
documents strict queue draining as setting both `minRunners` and `maxRunners` to `0`. Reserve that mode for an explicitly
coordinated emergency drain because the ordinary ARC image/Kargo workflow also requires an AMD64 runner.

GitHub can reject an outdated runner binary and ARC then marks its scale set `Outdated`, removes its listener, and
stops scheduling jobs. A successful controller health check does not prove runner capacity. If every build runner
is stopped, the runner image workflow cannot rebuild itself. An explicitly authorized bootstrap must first restore
enough runner capacity to execute the existing reviewed build and Kargo path. Keep the original desired state and
record the temporary changes and their restoration. Do not publish an operator-built image or bypass PR checks.

For current node placement and taint operations, start with `devices/galactic/README.md` and verify the target Talos node
before changing scheduling state.
