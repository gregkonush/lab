# Hello Server (cdk8s Example)

This example demonstrates how to model a simple HTTP server using [cdk8s](https://cdk8s.io/).
The TypeScript program synthesizes a base `Deployment` and `Service`, plus a development overlay
expressed as a Kustomize patch. The Argo CD `cdk8s` configuration management plugin runs
`cdk8s synth` and streams the rendered manifests so they can be applied to a cluster.

## Directory layout

```
packages/cloutt/examples/hello-server/
├── cdk8s.yaml          # Defines how the synthesizer executes the TypeScript program
├── main.ts             # Generates the base, overlay, and root kustomizations
├── package.json        # Local dependencies used by the plugin runtime
├── tsconfig.json       # TypeScript compiler options
└── README.md
```

Run `npx cdk8s synth` from this directory to regenerate the manifests locally. The output will
be placed in `dist/` with the following structure:

```
dist/
├── base/              # Core deployment + service
├── overlays/dev/      # Development patch overlay
└── kustomization.yaml # Root kustomization that targets the dev overlay
```

From here you can run `kustomize build dist/overlays/dev` to inspect the rendered YAML that Argo CD applies.
