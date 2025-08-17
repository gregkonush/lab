# Coder Template: Kubernetes Workspace (arm64)

This template provisions a Coder workspace on Kubernetes with:

- arm64 agent binary (for arm64 nodes)
- code-server preinstalled and exposed at <http://localhost:13337>
- Persistent home volume (PVC) sized via parameter `home_disk_size`

## Install

Prereqs:

- Coder CLI logged in to your instance (`coder login https://coder.proompteng.ai`)
- Admin access to push templates

Steps:

1. Navigate to this directory:

```bash
cd kubernetes/coder
```

2. Push the template into Coder:

```bash
coder templates push --directory . --yes
```

3. Create a workspace from the `kubernetes/coder` template in the UI, or via CLI:

```bash
coder workspaces create sutro --template "kubernetes/coder"
```

## Parameters

- CPU cores: 2/4/6/8
- Memory (GiB): 2/4/6/8
- Home disk size (GiB): default 10

## Notes

- The agent bootstrap is adjusted to fetch linux-arm64 to match your arm64 cluster nodes.
- If a workspace becomes unhealthy, check logs inside the pod:
  - `/tmp/coder-startup-script.log`
  - `/tmp/coder-agent.log`

## Troubleshooting

- Force restart a workspace pod to re-run the init:

```bash
kubectl -n coder delete pod -l app.kubernetes.io/name=coder-workspace
```

- SSH without waiting for the startup script:

```bash
coder ssh <workspace-name> --wait=no
```
