# Bootstrap

Install argo-cd CLI

```bash
brew install argocd
```

## Kustomization bootstrap

```bash
kubectl apply -k bootstrap/argo-cd
```

## Get initial password, login and update password

```bash
# Passing --grpc-web will make grpc calls afterwards
argocd admin initial-password -n argocd
argocd login argocd.proompteng.ai --grpc-web
argocd account update-password --account admin --server argocd.proompteng.ai
```

## Add a repo

```bash
argocd repo add https://github.com/gregkonush/lab
```

## Bootstrap root

```bash
argocd app create apps --file bootstrap/apps.yaml
```

## Upsert application

```bash
argocd app create --upsert root --file bootstrap/root.yaml
```

### Delete apps that got stuck in deleting phase

```bash
kubectl get application -n argocd
kubectl edit application
```

Remove finalizers from spec

