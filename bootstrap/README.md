# Bootstrap

kubectl apply -k ./bootstrap/argo-cd

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
argocd app create root --file bootstrap/root.yaml
```
