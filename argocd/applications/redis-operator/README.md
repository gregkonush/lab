# Redis Operator

- Managed via Argo CD from `argocd/applications/redis-operator`.
- Installs the [OT-Container-Kit Redis Operator](https://github.com/OT-CONTAINER-KIT/redis-operator) Helm chart (v0.22.1).
- Controller namespace: `redis-operator` (auto-created by Argo CD sync).

Check status:

```bash
kubectl -n argocd get application redis-operator
kubectl -n redis-operator get deploy,pod
```
