import { Chart, ChartProps, Duration } from 'cdk8s'
import { Construct } from 'constructs'
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
} from 'cdk8s-plus-33'

export interface ServerChartProps extends ChartProps {
  readonly image: string
  readonly replicas?: number
  readonly containerPort?: number
  readonly cpuTargetUtilizationPercent?: number
}

export class ServerChart extends Chart {
  constructor(scope: Construct, id: string, props: ServerChartProps) {
    super(scope, id, props)

    const appLabel = 'bonjour'
    const namespace = props.namespace ?? 'default'
    const port = props.containerPort ?? 3000
    const minReplicas = Math.max(props.replicas ?? 1, 1)
    const targetCpu = Math.min(Math.max(props.cpuTargetUtilizationPercent ?? 70, 1), 100)

    const deployment = new Deployment(this, 'server', {
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
      securityContext: {
        ensureNonRoot: true,
        user: 1000,
        group: 1000,
        fsGroup: 1000,
      },
    })

    deployment.addContainer({
      name: 'server',
      image: props.image,
      portNumber: port,
      envVariables: {
        PORT: EnvValue.fromValue(String(port)),
        NODE_ENV: EnvValue.fromValue('production'),
        OTEL_SERVICE_NAME: EnvValue.fromValue(appLabel),
        LGTM_TEMPO_TRACES_ENDPOINT: EnvValue.fromValue(
          'http://lgtm-tempo-gateway.lgtm.svc.cluster.local:4318/v1/traces',
        ),
        LGTM_MIMIR_METRICS_ENDPOINT: EnvValue.fromValue(
          'http://lgtm-mimir-nginx.lgtm.svc.cluster.local/otlp/v1/metrics',
        ),
        LGTM_LOKI_ENDPOINT: EnvValue.fromValue('http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push'),
        OTEL_EXPORTER_OTLP_PROTOCOL: EnvValue.fromValue('http/protobuf'),
        POD_NAME: EnvValue.fromFieldPath('metadata.name'),
        POD_NAMESPACE: EnvValue.fromFieldPath('metadata.namespace'),
      },
      securityContext: {
        ensureNonRoot: true,
        user: 1000,
        group: 1000,
      },
      readiness: Probe.fromHttpGet('/healthz', {
        port,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
      }),
      liveness: Probe.fromHttpGet('/healthz', {
        port,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
      }),
    })

    const ports: ServicePort[] = [
      {
        name: 'http',
        port,
        targetPort: port,
      },
    ]

    new Service(this, 'service', {
      metadata: {
        namespace,
        labels: {
          app: appLabel,
        },
      },
      selector: deployment,
      type: ServiceType.CLUSTER_IP,
      ports,
    })

    new HorizontalPodAutoscaler(this, 'hpa', {
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
    })
  }
}
