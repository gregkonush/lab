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
- The `arc-amd64` pool runs up to three runners on Turin with `local-path-turin-nvme-transcend`. The
  `arc-amd64-ryzen` pool runs up to two on `talos-192-168-1-194` with `local-path-ryzen`. Both advertise the
  `arc-amd64` workflow label, so existing jobs can use either pool. Each also advertises its host-specific label,
  `arc-amd64-turin` or `arc-amd64-ryzen`, for placement acceptance. The pools retain separate ARC identities and
  independent caps. Each runner uses one 45Gi generic ephemeral PVC for `/nix`, `/home/runner/.cache`, `/tmp`,
  `/home/runner/_work`, and Docker data. The init copies the image's Nix tree before the main containers mount it,
  checks the host's expected filesystem and free capacity, then verifies file bytes, file counts, and symlink counts.
  The PVC is deleted with the runner Pod. ARM64 and `analysis-arm64` retain their existing `emptyDir` workspaces.
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

The AMD64 pools total five runners: `arc-amd64` has `minRunners: 1`, `maxRunners: 3` on Turin, and
`arc-amd64-ryzen` has `minRunners: 1`, `maxRunners: 2` on Ryzen. ARC 0.14.2 supports the shared `arc-amd64` label
across distinct scale sets. Neither pool changes GitHub runner-group access or requires workflow routing changes.

Each runner reserves 16Gi and four logical CPUs across the runner and DinD. Ryzen has 128GiB installed, but its current
64GiB firmware GPU allocation leaves only 61.8GiB allocatable. Two runners reserve 32Gi and eight logical CPUs.
The 2026-10-11 inventory projected 14.95GiB and 7.78 logical CPUs for retained workloads after application Ceph clients
and all Bayn components leave Ryzen. Adding two runners brings that total to about 46.95GiB and 15.78 logical CPUs.
Verify fresh requests before delivery; do not rely on that projection while those moves remain unfinished.
The combined container memory limits are 32Gi per runner Pod, so concurrent bursts can still exhaust host memory.

The current two-plus-three split does not require a BIOS change or reboot. A future move of all five runners to Ryzen
requires reducing the GPU reservation through the
[Bosgame memory procedure](../../../devices/ryzen/docs/bosgame-m5-talos-drivers.md#cpu-and-gpu-memory-allocation),
then measuring post-reboot capacity and concurrent build load.

Apply the local class and complete the [Ryzen placement rollout](../../../devices/galactic/scheduling/README.md)
before promoting the runner configuration through Kargo. Existing busy Turin runners must finish normally.
The Ryzen pool's compute-local toleration is explicit so startup does not depend on admission mutation.
The ARM64 scale sets retain their existing placement and capacity. The Kargo Stage updates the image in all four
runner scale sets, including the Ryzen pool.

After both pools reconcile, dispatch `.github/workflows/arc-placement-acceptance.yml` from `main`. Its five matrix jobs
require the host-specific labels, check the actual downward-API node identity, and exercise local scratch, Nix, and
Docker without publishing an image. Two target Ryzen and three target Turin. This is placement and toolchain proof;
measure memory pressure, etcd latency, and NVMe contention under representative builds before increasing capacity.

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
