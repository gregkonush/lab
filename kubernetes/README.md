# Kubernetes installation

## Install k3sup

```bash
brew install k3sup
```

Generate a script to install a new cluster

```bash
k3sup plan hosts.json --servers 5 --user kalmyk > install.sh
```

Make install script executable

```bash
chmod +x install.sh
```

Install a new cluster

```bash
./install.sh
```

## Bootstrap GitOps (ArgoCD) – step by step

1) Install Sealed Secrets CRD (required by ArgoCD base kustomization):

```bash
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.32.1/controller.yaml
```

2) Apply ArgoCD base (HA install, image updater, Traefik IngressRoute, secrets):

```bash
kubectl apply -k argocd/applications/argocd
kubectl -n argocd get pods
```

3) Wait until ArgoCD is ready before proceeding:

```bash
kubectl -n argocd rollout status deploy/argocd-server --timeout=180s
kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=180s
```

4) Install MetalLB (provides External IPs for LoadBalancer Services like K3s Traefik):

```bash
kubectl apply -k argocd/applications/metallb-system
kubectl -n metallb-system rollout status deploy/controller --timeout=180s
kubectl -n metallb-system rollout status ds/speaker --timeout=300s
```

Notes:
- Edit `argocd/applications/metallb-system/ipaddresspool.yaml` to match your LAN range and avoid static IPs. Current pool: `192.168.1.100-192.168.1.149`.
- The K3s Traefik Service (`kube-system/traefik`) is type LoadBalancer and will be Pending until MetalLB assigns an External IP. After this step it should have an IP, e.g., `192.168.1.100`.

5) Apply the root Application (ApplicationSet) to sync the rest of the stack:

```bash
kubectl apply -f argocd/root.yaml
kubectl -n argocd get applications.argoproj.io
```

If the first apply fails with “no matches for kind Application … ensure CRDs are installed first”, wait ~30–60s and retry.

6) Monitor sync and platform components:

```bash
kubectl -n argocd get apps,applicationsets
kubectl -n argocd get pods -w
```

## K3sup flags explained (what we set and why)

The install script uses a set of high‑performance, safe defaults aligned with your current ArgoCD stack (Traefik, Flannel, MetalLB, local‑path still used by ARC).

Server flags (applied via `k3sup install` and server `k3sup join --server`):

- **--disable servicelb**: Disables K3s' built‑in klipper‑lb because you deploy MetalLB under `argocd/applications/metallb-system`. Prevents overlapping LBs.
- **--kube-proxy-arg=proxy-mode=ipvs**: Switches kube‑proxy from iptables to IPVS for better performance and scalability.
- **--kube-proxy-arg=ipvs-scheduler=wrr**: Uses Weighted Round‑Robin for more even backend distribution.
- **--kubelet-arg=cpu-manager-policy=static**: Enables CPU pinning for QoS Guaranteed pods (requests=limits, whole CPUs), reducing jitter.
- **--kubelet-arg=topology-manager-policy=single-numa-node**: Co-locates CPU/memory/devices on the same NUMA node when possible.
- **--kubelet-arg=reserved-cpus=0-3**: Reserves CPUs 0–3 for the OS/kube daemons to isolate system work from workloads. Adjust per node size.
  - In this repo: we reserve fewer CPUs on smaller nodes based on VM sizes in `tofu/harvester/main.tf`:
    - Masters (4 vCPU): `reserved-cpus=0-1` (2 cores for control plane/system)
    - Workers (4 vCPU): `reserved-cpus=0` (1 core for system, 3 cores for workloads)
- **--kubelet-arg=container-log-max-size=10Mi** and **--kubelet-arg=container-log-max-files=3**: Caps per‑container log size to avoid disk pressure.

Agent flags (applied via `k3sup join` for workers):

- Same kubelet args as above (CPU/NUMA/log rotation). Agents do not set kube‑proxy args.

Notes for your current setup:

- We do NOT disable kube‑proxy or Flannel because there is no eBPF CNI (e.g., Cilium) defined in `argocd/`. Service networking continues to rely on kube‑proxy.
- We keep Traefik enabled because several apps use Traefik `IngressRoute` CRDs.
- We do NOT pass `--disable local-storage` yet because `argocd/applications/arc/application.yaml` still uses `storageClassName: "local-path"`. After migrating ARC to Longhorn, you can consider disabling local‑path.

IPVS prerequisites (Ubuntu usually has these modules):

```bash
sudo modprobe ip_vs ip_vs_rr ip_vs_wrr ip_vs_sh nf_conntrack
```

Verify kube‑proxy mode on a node:

```bash
kubectl -n kube-system get ds kube-proxy -o yaml | rg -n "--proxy-mode|--ipvs-scheduler"
```

## Harvester VMs with OpenTofu (plan/apply with throttling)

For creating the Ubuntu VMs in Harvester via OpenTofu:

```bash
# Plan
tofu -chdir='./tofu/harvester' plan

# Apply with throttling to avoid provider timeouts
tofu -chdir='./tofu/harvester' apply -auto-approve -parallelism=3
```

Notes:
- If you see context deadline exceeded, lower `-parallelism` further (e.g. 2) or apply in batches using `-target`.
- zsh users: when using `-target`, quote or escape brackets to avoid globbing, e.g.:
  ```bash
  noglob tofu -chdir='./tofu/harvester' apply -auto-approve \
    -target 'harvester_virtualmachine.kube-cluster["kube-master-00"]' \
    -target 'harvester_virtualmachine.kube-cluster["kube-master-01"]' \
    -target 'harvester_virtualmachine.kube-cluster["kube-master-02"]'
  ```
- If a previous run failed, resources may be tainted for replacement. To keep current VMs, you can untaint then re-plan:
  ```bash
  tofu -chdir='./tofu/harvester' state list | awk '/^harvester_virtualmachine\./{print $1}' | \
    xargs -n1 tofu -chdir='./tofu/harvester' state untaint
  tofu -chdir='./tofu/harvester' plan
  ```

Set KUBECONFIG environment variable

```bash
echo "export KUBECONFIG=~/.kube/kubeconfig" >> ~/.zshrc
```

Check if cluster is running

```bash
 k get nodes
NAME             STATUS   ROLES                       AGE     VERSION
kube-master-00   Ready    control-plane,etcd,master   6m27s   v1.28.8+k3s1
kube-master-01   Ready    control-plane,etcd,master   6m7s    v1.28.8+k3s1
kube-master-02   Ready    control-plane,etcd,master   5m39s   v1.28.8+k3s1
kube-worker-00   Ready    <none>                      5m28s   v1.28.8+k3s1
kube-worker-01   Ready    <none>                      5m17s   v1.28.8+k3s1
kube-worker-02   Ready    <none>                      5m6s    v1.28.8+k3s1
kube-worker-03   Ready    <none>                      4m56s   v1.28.8+k3s1
kube-worker-04   Ready    <none>                      4m45s   v1.28.8+k3s1
kube-worker-05   Ready    <none>                      4m35s   v1.28.8+k3s1
```

## Tainting a node

To taint a node (for example, `kube-worker-08`) to prevent pod scheduling unless they have a matching toleration, use the following command:

```bash
kubectl taint nodes kube-worker-08 role=worker:NoSchedule
```

To remove the taint, you can use:

```bash
kubectl taint nodes kube-worker-08 role=worker:NoSchedule-
```

### Querying nodes for taints

To view the taints on all nodes in your cluster, you can use the following command:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

See key and value of taint on a node

```bash
kubectl describe node kube-worker-08 | grep Taint
```

To see all pods on a specific node:

```bash
kubectl get pods --field-selector spec.nodeName=kube-worker-08
```
