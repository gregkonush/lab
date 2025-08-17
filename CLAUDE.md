# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a comprehensive home cloud laboratory monorepo containing:

- Multiple applications (Next.js, React, TypeScript, Python, Go)
- Infrastructure as Code (OpenTofu/Terraform)
- GitOps deployment configurations (ArgoCD)
- Configuration management (Ansible)
- Kubernetes cluster management

## Common Development Commands

### Package Management & Dependencies

```bash
# Install all dependencies
pnpm install

# Clean all node_modules
pnpm run clean

# Format code using Biome
pnpm run format
```

### Application Development

```bash
# Start development servers
pnpm run dev:proompteng
pnpm run dev:findbobastore

# Build applications
pnpm run build:proompteng
pnpm run build:findbobastore
pnpm run build:reviseur

# Start production servers
pnpm run start:proompteng
pnpm run start:findbobastore

# Lint applications
pnpm run lint:proompteng
pnpm run lint:findbobastore
```

### Individual App Commands

```bash
# For apps using vinxi (like kitty-krew)
cd apps/kitty-krew
pnpm dev    # Start development server
pnpm build  # Build for production
pnpm start  # Start production server

# For Python apps (like alchimie)
cd apps/alchimie
uv sync     # Install dependencies
uv run dagster dev  # Start Dagster development server

# For Go services (like prix)
cd services/prix
go run .    # Run the service
go test ./... # Run tests
```

### Infrastructure Management

```bash
# Terraform/OpenTofu operations
pnpm run tf:plan     # Plan infrastructure changes
pnpm run tf:apply    # Apply infrastructure changes
pnpm run tf:destroy  # Destroy infrastructure

# Ansible configuration management
pnpm run ansible     # Run Rancher installation playbook

# Kubernetes operations
pnpm run k:install   # Install K3s cluster
pnpm run k:bootstrap # Bootstrap ArgoCD
pnpm run harvester:apply # Apply Harvester templates

# Direct kubectl operations
kubectl --kubeconfig ~/.kube/altra.yaml apply -f ./tofu/harvester/templates
```

## Architecture & Structure

### Monorepo Layout

- `/apps/` - Independent applications with their own package.json
- `/services/` - Go backend services
- `/argocd/` - GitOps deployment manifests and ApplicationSets
- `/tofu/` - Infrastructure as Code (OpenTofu/Terraform)
- `/ansible/` - Configuration management playbooks
- `/kubernetes/` - Cluster setup and management scripts

### Key Technologies

- **Frontend**: Next.js 15, React 19, TanStack Router, tRPC, Tailwind CSS
- **Backend**: Go 1.24, Node.js 22.14, Python 3.9-3.13
- **Data**: Dagster, Temporal, PostgreSQL, Kafka
- **Infrastructure**: Kubernetes (K3s), ArgoCD, Harvester, Ansible
- **Tooling**: PNPM 9.15.2, Biome, Turbo, Docker

### Application Patterns

- **Next.js apps**: Use App Router, TypeScript, Tailwind CSS, shadcn/ui
- **React apps**: TanStack Router with tRPC for type-safe APIs
- **Python apps**: Dagster for data pipelines, UV for dependency management
- **Go services**: Temporal workflows, PostgreSQL integration

### Infrastructure Patterns

- **GitOps**: ArgoCD ApplicationSets with Kustomize overlays
- **Multi-environment**: Dev/prod overlays in `/argocd/applications/*/overlays/`
- **Service mesh**: Istio components for ingress and networking
- **Storage**: Longhorn for persistent volumes, MinIO for object storage

## Development Notes

### Code Standards

- Use Biome for formatting and linting (configured in biome.json)
- Follow existing TypeScript patterns in each app
- Maintain consistent indentation (2 spaces, single quotes)

### Container Registry

- Private registry: `kalmyk.duckdns.org` (for ARM64 builds)
- Build scripts available in `/scripts/` directory

### Kubernetes Contexts

- Harvester cluster config: `~/.kube/altra.yaml`
- Use `kubectl --kubeconfig ~/.kube/altra.yaml` for cluster operations

### Testing

- Check individual app package.json for test commands
- Go services: `go test ./...`
- Python apps: `pytest` (when available)
