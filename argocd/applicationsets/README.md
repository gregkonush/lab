# Bootstrap

Install argo-cd CLI

```bash
# Manually create the rest of kubernetes resources for harvester
k --kubeconfig ~/.kube/altra.yaml apply -f tofu/harvester/templates/
```

```bash
brew install argocd
```

## Kustomization bootstrap

```bash
k apply -k argocd/applications/argocd
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

## Bootstrap argocd

```bash
argocd app create --file argocd/root/application.yaml
```

## Update argocd

```bash
argocd app create --upsert --file argocd/root/application.yaml
```

### Delete argocd that got stuck in deleting phase

```bash
kubectl get application -n argocd
kubectl edit application
```

Remove finalizers from spec

