# ArgoCD Applications

This directory contains the ArgoCD application configurations for deploying applications to Kubernetes clusters.

## Structure

```
argocd/
├── applications/     # Individual application manifests
│   ├── kitty-krew/   # Example of kustomize-based application
│   │   ├── base/     # Base resources
│   │   ├── overlays/ # Environment-specific overlays
│   │   └── kustomization.yaml  # Root kustomization
│   └── ...
├── applicationsets/  # ApplicationSet definitions
└── root.yaml         # Root application
```

## ApplicationSets

Applications in the `applications/` directory are automatically discovered and deployed by the ApplicationSet defined in `applicationsets/lovely-apps.yaml`. This removes the need for creating individual Application resources.

## Kustomize Approach (kitty-krew)

The `kitty-krew` application demonstrates a reusable pattern using Kustomize for managing multi-environment deployments:

### Base Resources

The `base/` directory contains the foundational resources:

- `deployment.yaml` - Base deployment configuration
- `service.yaml` - Service definition
- `configmap.yaml` - Common configuration values
- `kustomization.yaml` - Lists all resources and common labels

### Environment Overlays

The `overlays/` directory contains environment-specific configurations:

- `dev/` - Development environment
- `prod/` - Production environment

Each overlay:

1. References the base resources
2. Applies environment-specific patches
3. Sets appropriate image tags
4. Configures environment-specific values

### Root Kustomization

The root `kustomization.yaml` references the dev overlay by default:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - overlays/dev # Default to dev overlay
```

## Using the Pattern for New Applications

To create a new application using this pattern:

1. Copy the `kitty-krew` directory structure to a new directory with your application name
2. Update resource names, labels, and selectors
3. Modify environment-specific configurations in the overlays
4. The ApplicationSet will automatically discover and deploy the new application

## Switching Environments

To switch from dev to production:

```yaml
# In your-app/kustomization.yaml
resources:
  - overlays/prod # Switch to prod overlay
```

## Best Practices

- Keep base configurations minimal and reusable
- Use overlays for environment-specific configurations
- Use strategic patches to only specify changing values
- Define resource limits appropriately for each environment
- Keep root kustomization.yaml pointing to dev by default
- Use ConfigMaps for application configuration
- Follow naming conventions consistently

## Debugging

To debug application deployment:

```bash
# Preview what will be deployed (dev)
kubectl kustomize argocd/applications/kitty-krew

# Preview production overlay
kubectl kustomize argocd/applications/kitty-krew/overlays/prod
```

### Private Docker registry credentials (with 1Password CLI)

- **Install 1Password CLI (macOS)**

```bash
brew install 1password-cli
op --version
# Sign in (interactive) so `op read` works in your shell
op signin
```

- **Create registry secret in the `argocd` namespace**

```bash
kubectl create secret docker-registry registry \
  --docker-server=https://kalmyk.duckdns.org \
  --docker-username=lab \
  --docker-password="$(op read op://vault_name/secret_name/field_name)" \
  --namespace=argocd \
  --dry-run=client -o yaml
```
