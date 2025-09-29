import {
  App,
  ApiObject,
  ApiObjectProps,
  Chart,
  ChartProps,
  YamlOutputType,
} from "cdk8s";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";

interface ContainerResources {
  readonly cpuRequest: string;
  readonly cpuLimit: string;
  readonly memoryRequest: string;
  readonly memoryLimit: string;
}

interface ServiceProps {
  readonly name: string;
  readonly image: string;
  readonly containerPort: number;
  readonly servicePort: number;
  readonly replicas: number;
  readonly resources: ContainerResources;
  readonly namespace?: string;
  readonly env?: Record<string, string>;
}

class WebDeployment extends Chart {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceProps,
    chartProps?: ChartProps,
  ) {
    super(scope, id, chartProps);

    const labels = { app: props.name };

    const deployment: ApiObjectProps = {
      metadata: {
        name: props.name,
        labels,
        namespace: props.namespace,
      },
      spec: {
        replicas: props.replicas,
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
                name: props.name,
                image: props.image,
                ports: [
                  {
                    containerPort: props.containerPort,
                  },
                ],
                readinessProbe: {
                  httpGet: {
                    path: "/",
                    port: props.containerPort,
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: {
                    path: "/",
                    port: props.containerPort,
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 20,
                },
                resources: {
                  requests: {
                    cpu: props.resources.cpuRequest,
                    memory: props.resources.memoryRequest,
                  },
                  limits: {
                    cpu: props.resources.cpuLimit,
                    memory: props.resources.memoryLimit,
                  },
                },
                env: props.env
                  ? Object.entries(props.env).map(([name, value]) => ({
                      name,
                      value,
                    }))
                  : undefined,
              },
            ],
          },
        },
      },
      apiVersion: "apps/v1",
      kind: "Deployment",
    };

    new ApiObject(this, "deployment", deployment);
  }
}

class WebService extends Chart {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceProps,
    chartProps?: ChartProps,
  ) {
    super(scope, id, chartProps);

    const labels = { app: props.name };

    const service: ApiObjectProps = {
      metadata: {
        name: props.name,
        labels,
        namespace: props.namespace,
      },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [
          {
            port: props.servicePort,
            targetPort: props.containerPort,
          },
        ],
      },
      apiVersion: "v1",
      kind: "Service",
    };

    new ApiObject(this, "service", service);
  }
}

interface KustomizationProps {
  readonly namespace?: string;
  readonly resources: string[];
  readonly patches?: string[];
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

    new ApiObject(this, "config", manifest);
  }
}

class DeploymentPatchChart extends Chart {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceProps,
    chartProps?: ChartProps,
  ) {
    super(scope, id, chartProps);

    const patch: ApiObjectProps = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: props.name,
      },
      spec: {
        replicas: props.replicas,
        template: {
          spec: {
            containers: [
              {
                name: props.name,
                image: props.image,
                env: props.env
                  ? Object.entries(props.env).map(([name, value]) => ({
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

    new ApiObject(this, "patch", patch);
  }
}

function cleanupDist(directory: string): void {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const distDir = path.join(__dirname, "dist");
cleanupDist(distDir);

const baseManifest = new App({
  outdir: path.join(distDir, "base"),
  outputFileExtension: ".yaml",
  yamlOutputType: YamlOutputType.FILE_PER_CHART,
});

const baseProps: ServiceProps = {
  name: "hello-server",
  image: "ghcr.io/gregkonush/hello-server:latest",
  containerPort: 8080,
  servicePort: 80,
  replicas: 2,
  resources: {
    cpuRequest: "100m",
    cpuLimit: "500m",
    memoryRequest: "128Mi",
    memoryLimit: "256Mi",
  },
};

new WebDeployment(baseManifest, "deployment", baseProps);
new WebService(baseManifest, "service", baseProps);
new KustomizationChart(baseManifest, "kustomization", {
  resources: ["deployment.yaml", "service.yaml"],
});
baseManifest.synth();

const devManifest = new App({
  outdir: path.join(distDir, "overlays", "dev"),
  outputFileExtension: ".yaml",
  yamlOutputType: YamlOutputType.FILE_PER_CHART,
});

const devProps: ServiceProps = {
  ...baseProps,
  image: "ghcr.io/gregkonush/hello-server:dev",
  replicas: 1,
  env: {
    LOG_LEVEL: "debug",
    GREETING: "Hello from development!",
  },
};

new DeploymentPatchChart(devManifest, "deployment-patch", devProps);
new KustomizationChart(devManifest, "kustomization", {
  resources: ["../../base"],
  patches: ["deployment-patch.yaml"],
});
devManifest.synth();

const rootManifest = new App({
  outdir: distDir,
  outputFileExtension: ".yaml",
  yamlOutputType: YamlOutputType.FILE_PER_CHART,
});

new KustomizationChart(rootManifest, "kustomization", {
  resources: ["overlays/dev"],
});
rootManifest.synth();
