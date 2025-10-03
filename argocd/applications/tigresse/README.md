# Tigresse Operator

Installs the Tigresse TigerBeetle operator. Apply with Argo CD via the platform ApplicationSet entry.

## Resources

- `tigresse-controller-manager` deployment running the controller-runtime binary
- Cluster scoped RBAC granting control of TigerBeetleCluster resources and owned workloads
- CustomResourceDefinition for `TigerBeetleCluster`
