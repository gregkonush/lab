import {
  App,
  ApiObject,
  ApiObjectProps,
  Chart,
  ChartProps,
  YamlOutputType,
} from "cdk8s";
import { Construct } from "constructs";
import * as path from "node:path";

interface ResourceQuantities {
  readonly cpu: string;
  readonly memory: string;
}

interface BonjourConfig {
  readonly name: string;
  readonly namespace: string;
  readonly image: string;
  readonly containerPort: number;
  readonly servicePort: number;
  readonly replicas: number;
  readonly resources: {
    readonly requests: ResourceQuantities;
    readonly limits: ResourceQuantities;
  };
  readonly environment?: Record<string, string>;
}

interface KustomizationProps {
  readonly resources: string[];
  readonly namespace?: string;
  readonly patches?: string[];
}

class BonjourWorkload extends Chart {
  constructor(
    scope: Construct,
    id: string,
    config: BonjourConfig,
    props?: ChartProps,
  ) {
    super(scope, id, props);

    const labels = {
      "app.kubernetes.io/name": config.name,
      "app.kubernetes.io/instance": config.name,
    };

    const env = config.environment
      ? Object.entries(config.environment).map(([name, value]) => ({
          name,
          value,
        }))
      : undefined;

    const deployment: ApiObjectProps = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels,
      },
      spec: {
        replicas: config.replicas,
        selector: {
          matchLabels: labels,
        },
        template: {
          metadata: {
            labels,
          },
          spec: {
            containers: [
              {
                name: config.name,
                image: config.image,
                ports: [
                  {
                    containerPort: config.containerPort,
                  },
                ],
                env,
                readinessProbe: {
                  httpGet: {
                    path: "/",
                    port: config.containerPort,
                  },
                  initialDelaySeconds: 3,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: {
                    path: "/",
                    port: config.containerPort,
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 30,
                },
                resources: {
                  requests: {
                    cpu: config.resources.requests.cpu,
                    memory: config.resources.requests.memory,
                  },
                  limits: {
                    cpu: config.resources.limits.cpu,
                    memory: config.resources.limits.memory,
                  },
                },
              },
            ],
          },
        },
      },
    };

    new ApiObject(this, "deployment", deployment);

    const service: ApiObjectProps = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels,
      },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [
          {
            port: config.servicePort,
            targetPort: config.containerPort,
          },
        ],
      },
    };

    new ApiObject(this, "service", service);
  }
}

class DeploymentPatchChart extends Chart {
  constructor(
    scope: Construct,
    id: string,
    config: BonjourConfig,
    props?: ChartProps,
  ) {
    super(scope, id, props);

    const patch: ApiObjectProps = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: config.name,
        namespace: config.namespace,
      },
      spec: {
        replicas: config.replicas,
        template: {
          spec: {
            containers: [
              {
                name: config.name,
                image: config.image,
                env: config.environment
                  ? Object.entries(config.environment).map(([name, value]) => ({
                      name,
                      value,
                    }))
                  : undefined,
              },
            ],
          },
        },
      },
    };

    new ApiObject(this, "deployment", patch);
  }
}

class KustomizationChart extends Chart {
  constructor(
    scope: Construct,
    id: string,
    props: KustomizationProps,
    chartProps?: ChartProps,
  ) {
    super(scope, id, chartProps);

    const manifest: ApiObjectProps = {
      apiVersion: "kustomize.config.k8s.io/v1beta1",
      kind: "Kustomization",
      resources: props.resources,
      ...(props.namespace ? { namespace: props.namespace } : {}),
      ...(props.patches && props.patches.length > 0
        ? { patchesStrategicMerge: props.patches }
        : {}),
    };

    new ApiObject(this, "kustomization", manifest);
  }
}

function synthesize(): void {
  const distDir = path.resolve(__dirname, "..", "..", "dist");

  const baseConfig: BonjourConfig = {
    name: "bonjour",
    namespace: "bonjour",
    image: "ghcr.io/gregkonush/bonjour:main",
    containerPort: 8080,
    servicePort: 80,
    replicas: 1,
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "250m", memory: "128Mi" },
    },
    environment: {
      PORT: "8080",
    },
  };

  const devOverlayConfig: BonjourConfig = {
    ...baseConfig,
    image: "ghcr.io/gregkonush/bonjour:dev",
    replicas: 2,
    environment: {
      ...baseConfig.environment,
      LOG_LEVEL: "debug",
    },
  };

  const baseApp = new App({
    outdir: path.join(distDir, "base"),
    outputFileExtension: ".yaml",
    yamlOutputType: YamlOutputType.FILE_PER_CHART,
  });

  new BonjourWorkload(baseApp, "workload", baseConfig);
  new KustomizationChart(baseApp, "kustomization", {
    namespace: baseConfig.namespace,
    resources: ["workload.k8s.yaml"],
  });

  baseApp.synth();

  const devOverlayApp = new App({
    outdir: path.join(distDir, "overlays", "dev"),
    outputFileExtension: ".yaml",
    yamlOutputType: YamlOutputType.FILE_PER_CHART,
  });

  new DeploymentPatchChart(devOverlayApp, "deployment-patch", devOverlayConfig);
  new KustomizationChart(devOverlayApp, "kustomization", {
    namespace: devOverlayConfig.namespace,
    resources: ["../../base"],
    patches: ["deployment-patch.k8s.yaml"],
  });

  devOverlayApp.synth();

  const rootApp = new App({
    outdir: distDir,
    outputFileExtension: ".yaml",
    yamlOutputType: YamlOutputType.FILE_PER_CHART,
  });

  new KustomizationChart(rootApp, "kustomization", {
    resources: ["overlays/dev"],
  });

  rootApp.synth();
}

synthesize();
