import type { Construct } from 'constructs'
import { Kustomization } from './common/kustomization'
import { Chart } from 'cdk8s'

export class RootKustomization extends Chart {
  constructor(scope: Construct, id: string, props: { overlays: string[] }) {
    super(scope, id)
    new Kustomization(this, id, {
      resources: props.overlays,
    })
  }
}
