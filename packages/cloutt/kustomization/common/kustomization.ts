import { Chart } from 'cdk8s'
import type { Construct } from 'constructs'
import { ApiObject } from 'cdk8s'
import { z } from 'zod'

const kustomizationSchema = z.object({
  resources: z.array(z.string()),
})

export class Kustomization extends Chart {
  constructor(scope: Construct, id: string, props: z.infer<typeof kustomizationSchema>) {
    super(scope, id)

    kustomizationSchema.parse(props)
    this.#createKustomization(id, props)
  }

  #createKustomization(id: string, props: z.infer<typeof kustomizationSchema>) {
    new ApiObject(this, `${id}-kustomization`, {
      apiVersion: 'kustomize.config.k8s.io/v1beta1',
      kind: 'Kustomization',
      resources: props.resources,
    })
  }
}
