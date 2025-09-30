# Bonjour Serveur

This package contains a minimal TypeScript HTTP server named **Bonjour Serveur**
and the CDK8s program that models its Kubernetes deployment. The service exposes
a single `GET /` endpoint that returns the string `bonjour` and is intended to be
built into a container image published as `ghcr.io/gregkonush/bonjour-serveur`.

The CDK8s program renders a base Kustomize package, a `dev` overlay, and a root
kustomization that targets the overlay. Argo CD executes the program via the
`cdk8s` config management plugin that is registered in `argocd-cm`.

## Layout

```
packages/cloutt/bonjour-serveur/
├── cdk8s.yaml              # config for running the CDK8s synthesizer
├── src/infra/app.ts        # synthesizes base + overlay manifests
├── src/server/server.ts    # simple Node.js HTTP server implementation
├── package.json            # workspace manifest and scripts
├── tsconfig.json           # compiler configuration for the server + infra code
└── README.md
```

## Useful commands

All commands should be run with `pnpm` from the repository root:

- `pnpm --filter @cloutt/bonjour-serveur dev` – start the server locally with `ts-node`
- `pnpm --filter @cloutt/bonjour-serveur build` – compile the server to JavaScript under `lib/`
- `pnpm --filter @cloutt/bonjour-serveur start` – run the compiled server from `lib/`
- `pnpm --filter @cloutt/bonjour-serveur synth` – render the Kubernetes manifests into `dist/`

After synthesizing you can explore the manifests with:

```
kustomize build packages/cloutt/bonjour-serveur/dist/overlays/dev
```
