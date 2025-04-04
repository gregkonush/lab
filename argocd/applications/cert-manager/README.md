# Cert-Manager

## Known Issues

### Cainjector Leader Election

**Issue:** Cainjector tries to use kube-system for leader election by default, causing permission errors when deployed in cert-manager namespace.

**Reference:** [cert-manager/cert-manager#6716](https://github.com/cert-manager/cert-manager/issues/6716)

**Fix:** Set leader election namespace in Helm values:

```yaml
global:
  leaderElection:
    namespace: cert-manager
```
