# Kubernetes installation

## First time installation

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

## Install a cluster

```bash
./install.sh
```

Move new configuration for new cluster

```bash
cp kubeconfig ~/.kube/kubeconfig
```

Set KUBECONFIG environment variable

```bash
`echo "export KUBECONFIG=~/.kube/kubeconfig" >> ~/.zshrc`
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

## Get a token from a running cluster

Choose a server ip from hosts.json and ssh

```bash
sudo su`
cat /etc/rancher/k3s/k3s.yaml`
```

Copy the content of the output to a new file in ~/.kube/kubeconfig

Change the server ip address in the kubeconfig to 192.168.1.150:6443 from 127.0.0.1:6443

Test that configuration works

```bash
kubectl get pods
```

Expected output `No resources found in default namespace.`

### Recover argocd installation

```bash
argocd-autopilot repo bootstrap --recover
```
