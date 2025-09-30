import { Chart, ChartProps, Duration } from "cdk8s";
import { Construct } from "constructs";
import {
  Deployment,
  EnvValue,
  HorizontalPodAutoscaler,
  Metric,
  MetricTarget,
  Probe,
  Service,
  ServicePort,
  ServiceType,
} from "cdk8s-plus-33";

export interface ServerChartProps extends ChartProps {
  readonly image: string;
  readonly replicas?: number;
  readonly containerPort?: number;
  readonly cpuTargetUtilizationPercent?: number;
}

export class ServerChart extends Chart {
  constructor(scope: Construct, id: string, props: ServerChartProps) {
    super(scope, id, props);

    const appLabel = "bonjour";
    const namespace = props.namespace ?? "default";
    const port = props.containerPort ?? 3000;
    const minReplicas = Math.max(props.replicas ?? 1, 1);
    const targetCpu = Math.min(
      Math.max(props.cpuTargetUtilizationPercent ?? 70, 1),
      100,
    );

    const deployment = new Deployment(this, "server", {
      metadata: {
        namespace,
        labels: {
          app: appLabel,
        },
      },
      podMetadata: {
        labels: {
          app: appLabel,
        },
      },
      replicas: minReplicas,
    });

    deployment.addContainer({
      name: "server",
      image: props.image,
      portNumber: port,
      envVariables: {
        PORT: EnvValue.fromValue(String(port)),
        NODE_ENV: EnvValue.fromValue("production"),
      },
      readiness: Probe.fromHttpGet("/healthz", {
        port,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
      }),
    });

    const ports: ServicePort[] = [
      {
        name: "http",
        port,
        targetPort: port,
      },
    ];

    new Service(this, "service", {
      metadata: {
        namespace,
        labels: {
          app: appLabel,
        },
      },
      selector: deployment,
      type: ServiceType.CLUSTER_IP,
      ports,
    });

    new HorizontalPodAutoscaler(this, "hpa", {
      metadata: {
        namespace,
        labels: {
          app: appLabel,
        },
      },
      target: deployment,
      minReplicas,
      maxReplicas: Math.max(minReplicas * 2, minReplicas + 1),
      metrics: [Metric.resourceCpu(MetricTarget.averageUtilization(targetCpu))],
    });
  }
}
