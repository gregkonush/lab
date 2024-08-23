# Cert Manager

## There is a manual step

Install CRD

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.crds.yaml
```

## Delete cert-manager resources

[docs](https://cert-manager.io/docs/installation/kubectl/#uninstalling)

```bash
kubectl delete -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.yaml
```
