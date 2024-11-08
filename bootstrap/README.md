# Bootstrap

Install argo-cd CLI

```bash
brew install argocd
```

## Kustomization bootstrap

```bash
kubectl apply -k apps/argocd
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

## Bootstrap apps

```bash
argocd app create --file apps/root/application.yaml
```

## Update apps

```bash
argocd app create --upsert --file apps/root/application.yaml
```

### Delete apps that got stuck in deleting phase

```bash
kubectl get application -n argocd
kubectl edit application
```

Remove finalizers from spec

