# Argo CD Image Updater

Generate a token for update user

```bash
argocd account generate-token --account imageUpdater --id imageUpdater
```

Generate a secret from the token

```bash
kubectl create secret generic argocd-image-updater-secret --from-literal=argocd.token=<token> -n argocd-image-updater --dry-run=client -o yaml > plain-secret.yaml
```

Seal the secret

```bash
kubeseal --controller-name sealed-secrets -f secret.yaml -w sealed.yaml
```
