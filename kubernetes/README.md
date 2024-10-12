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

Move new configuration for new cluster

```bash
cp kubeconfig ~/.kube/kubeconfig
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
