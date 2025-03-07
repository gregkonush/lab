import { Protocol, ServiceType } from 'cdk8s-plus-31'
import type { Construct } from 'constructs'
import { Chart } from 'cdk8s'
import { z } from 'zod'
import { KustomizationService } from './common/service'
import { KustomizationDeployment } from './common/deployment'

const chartSchema = z.object({
  name: z.string(),
  replicas: z.number().min(1),
  image: z.string().startsWith('kalmyk.duckdns.org/lab/'),
  containerPort: z.number().min(1).max(65535),
  cpuRequest: z.number().min(1),
  cpuLimit: z.number().min(1),
  memoryRequest: z.number().min(1),
  memoryLimit: z.number().min(1),
})

export class KustomizationBase extends Chart {
  constructor(scope: Construct, id: string, props: z.infer<typeof chartSchema>) {
    super(scope, id)
    chartSchema.parse(props)
    new KustomizationDeployment(this, id, {
      name: props.name,
      replicas: props.replicas,
      image: props.image,
      containerPort: props.containerPort,
      cpuRequest: props.cpuRequest,
      cpuLimit: props.cpuLimit,
      memoryRequest: props.memoryRequest,
      memoryLimit: props.memoryLimit,
    })

    console.log('Created deployment manifest')

    new KustomizationService(this, id, {
      name: props.name,
      type: ServiceType.CLUSTER_IP,
      selector: {
        app: props.name,
      },
      ports: [
        {
          port: 80,
          targetPort: props.containerPort,
          protocol: Protocol.TCP,
        },
      ],
    })
    console.log('Created service manifest')
  }
}
