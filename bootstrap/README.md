# Bootstrap

kubectl apply -k ./bootstrap/argo-cd
helm upgrade --install argocd bootstrap/argo-cd --namespace argocd --create-namespace

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
