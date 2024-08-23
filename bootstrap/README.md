# Bootstrap

Add argo-cd helm charts

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

Pull charts

```bash
cd bootstrap/argo-cd
helm dep up
```

Apply argo-cd helm charts

```bash
helm template argocd bootstrap/argo-cd --namespace argocd | kubectl apply -f -
```

## Get initial password, login and update password

```bash
argocd admin initial-password -n argocd
argocd login argocd.proompteng.ai
argocd account update-password --account admin --server argocd.proompteng.ai
```

## Add a repo

```bash
argocd repo add https://github.com/gregkonush/lab
```

## Bootstrap root

```bash
argocd app create argocd --file bootstrap/argocd.yaml
argocd app create root --file bootstrap/root.yaml
```

### Delete apps that got stuck in deleting phase

```bash
kubectl get application -n argocd
kubectl edit application
```

Remove finalizers from spec
