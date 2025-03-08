import { App, YamlOutputType } from 'cdk8s'
import { RootKustomization } from './kustomization/root'
import { KustomizationBase } from './kustomization/base'

if (require.main === module) {
  const kustomizationManifest = new App({
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  })
  new RootKustomization(kustomizationManifest, 'kustomization', { overlays: ['overlays/dev'] })
  kustomizationManifest.synth()

  const appName = 'reviseur'

  const overlays = new App({
    outdir: 'dist/base',
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  })
  new KustomizationBase(overlays, 'kustomization', {
    name: appName,
    replicas: 1,
    image: `kalmyk.duckdns.org/lab/${appName}`,
    containerPort: 3000,
    cpuRequest: 100,
    cpuLimit: 500,
    memoryRequest: 128,
    memoryLimit: 512,
  })
  overlays.synth()
}
