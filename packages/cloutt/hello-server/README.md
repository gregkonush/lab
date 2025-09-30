# Hello Server

This package contains a minimal TypeScript HTTP server and the CDK8s program that
models its Kubernetes deployment. The server exposes a single `GET /` endpoint
that returns the string `hello` and is intended to be built into a container
image published as `ghcr.io/gregkonush/hello-server`.

The CDK8s program renders a base Kustomize package along with a `dev` overlay and
a root kustomization that targets the overlay. Argo CD executes the program via
the `cdk8s` config management plugin that is registered in `argocd-cm`.

## Layout

```
packages/cloutt/hello-server/
├── cdk8s.yaml              # config for running the CDK8s synthesizer
├── src/infra/app.ts        # synthesizes base + overlay manifests
├── src/server/server.ts    # simple Node.js HTTP server implementation
├── package.json            # pinned dependencies for the plugin runtime
├── tsconfig.json           # compiler configuration for the server + infra code
└── README.md
```

## Useful commands

- `npm run dev` – start the server locally with `ts-node`
- `npm run build` – compile the server to JavaScript under `lib/`
- `npm run start` – run the compiled server from `lib/`
- `npm run synth` – render the Kubernetes manifests into `dist/`

After synthesizing you can explore the manifests with:

```
kustomize build dist/overlays/dev
```
