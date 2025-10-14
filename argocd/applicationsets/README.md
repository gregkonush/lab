# Bootstrap

Install the Argo CD CLI:

```bash
brew install argocd
```

Prepare the cluster resources required by Harvester:

```bash
k --kubeconfig ~/.kube/altra.yaml apply -f tofu/harvester/templates/
```

## Deploy Argo CD itself

Apply the Argo CD manifests with Kustomize to get the control plane and Lovely plugin online:

```bash
k apply -k argocd/applications/argocd
```

Retrieve the initial admin password, log in, and rotate credentials:

```bash
argocd admin initial-password -n argocd
argocd login argocd.proompteng.ai --grpc-web
argocd account update-password --account admin --server argocd.proompteng.ai
```

Add this repository to Argo CD:

```bash
argocd repo add https://github.com/proompteng/lab.git
```

## Stage-based ApplicationSets

The repo now provides four staged ApplicationSets:

- `bootstrap.yaml` (core prerequisites)
- `platform.yaml` (shared infrastructure & tooling)
- `product.yaml` (product-facing workloads)
- `cdk8s.yaml` (TypeScript-driven CMP workloads powered by the cdk8s plugin)

Sync the `root` Application to register the staged sets:

```bash
argocd app create root --file argocd/root.yaml
argocd app sync root
```

Preview what each stage would create before syncing:

```bash
argocd appset preview --app bootstrap --output table
```

Sync individual stages when you are ready:

```bash
argocd appset create --upsert argocd/applicationsets/bootstrap.yaml
argocd appset create --upsert argocd/applicationsets/platform.yaml
argocd appset create --upsert argocd/applicationsets/product.yaml
argocd appset create --upsert argocd/applicationsets/cdk8s.yaml
```

All generated Applications default to manual sync. Promote a workload by running `argocd app sync <name>`. Once stable, flip its `automation` value to `auto` inside the relevant stage file to enable automatic reconcilation.

### Removing stuck Applications

Should an Application get stuck in a deleting phase, drop the finalizers:

```bash
kubectl get application -n argocd
kubectl edit application
```

Remove the `finalizers` array from the spec and save.
