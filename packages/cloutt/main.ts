import type { Construct } from 'constructs'
import { App, Chart, type ChartProps } from 'cdk8s'
import { k8s } from 'cdk8s-plus-31'
import { ApiObject } from 'cdk8s'

export class KittyKrewChart extends Chart {
  private readonly k8sNamespace: k8s.KubeNamespace
  private readonly serviceAccount: k8s.KubeServiceAccount
  private readonly clusterRole: k8s.KubeClusterRole
  private readonly clusterRoleBinding: k8s.KubeClusterRoleBinding
  private readonly configMap: k8s.KubeConfigMap
  private readonly deployment: k8s.KubeDeployment
  private readonly registrySecret: ApiObject

  constructor(scope: Construct, id: string, props: ChartProps = {}) {
    super(scope, id, props)

    // Create resources in order (similar to sync-wave)
    this.k8sNamespace = this.#createNamespace()
    console.log(`Created namespace ${this.k8sNamespace.name}`)

    this.serviceAccount = this.#createServiceAccount()
    console.log(`Created service account ${this.serviceAccount.name}`)

    this.clusterRole = this.#createClusterRole()
    console.log(`Created cluster role ${this.clusterRole.name}`)

    this.clusterRoleBinding = this.#createClusterRoleBinding()
    console.log(`Created cluster role binding ${this.clusterRoleBinding.name}`)

    this.configMap = this.#createConfigMap()
    console.log(`Created config map ${this.configMap.name}`)

    this.registrySecret = this.#createRegistrySecret()
    console.log(`Created registry sealed secret ${this.registrySecret.name}`)

    this.deployment = this.#createDeployment()
    console.log(`Created deployment ${this.deployment.name}`)
  }

  #createNamespace(): k8s.KubeNamespace {
    return new k8s.KubeNamespace(this, 'Namespace', {
      metadata: {
        name: 'kitty-krew-dev',
        annotations: {
          'argocd.argoproj.io/sync-wave': '-1',
        },
        labels: {
          'app.kubernetes.io/part-of': 'kitty-krew',
          environment: 'development',
        },
      },
    })
  }

  #createServiceAccount(): k8s.KubeServiceAccount {
    return new k8s.KubeServiceAccount(this, 'ServiceAccount', {
      metadata: {
        name: 'kitty-krew-sa',
        namespace: 'kitty-krew-dev',
      },
    })
  }

  #createClusterRole(): k8s.KubeClusterRole {
    return new k8s.KubeClusterRole(this, 'ClusterRole', {
      metadata: {
        name: 'pod-reader',
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['pods'],
          verbs: ['get', 'watch', 'list'],
        },
        {
          apiGroups: [''],
          resources: ['pods/log'],
          verbs: ['get'],
        },
      ],
    })
  }

  #createClusterRoleBinding(): k8s.KubeClusterRoleBinding {
    return new k8s.KubeClusterRoleBinding(this, 'ClusterRoleBinding', {
      metadata: {
        name: 'pod-reader-binding',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'kitty-krew-sa',
          namespace: 'default',
        },
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: 'pod-reader',
        apiGroup: 'rbac.authorization.k8s.io',
      },
    })
  }

  #createConfigMap(): k8s.KubeConfigMap {
    return new k8s.KubeConfigMap(this, 'ConfigMap', {
      metadata: {
        name: 'kitty-krew-config',
        namespace: 'kitty-krew-dev',
      },
      data: {
        APP_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
    })
  }

  #createRegistrySecret() {
    const apiObject = new ApiObject(this, 'RegistrySecret', {
      apiVersion: 'bitnami.com/v1alpha1',
      kind: 'SealedSecret',
      metadata: {
        name: 'registry',
        namespace: 'kitty-krew-dev',
        creationTimestamp: null,
      },
      spec: {
        encryptedData: {
          '.dockerconfigjson':
            'AgCrC14f5/vQR5AVi7XBZS6/FlfB4wFRLN2fnG88F0mhDUKhTacDIwuAaScc7RRxWf1MHgVm9sQZNxtOron6DvIkB1CQU4jOxt0iE8oMPRJCMGwQuEt5x6dcFaSF+ioBwFqtelTfZorHyIUMRJm3EjLMql0Giko4zxdXwC5oBzoe94IwodHl5N9uETlGb4g/+JWIEBBpvrtu7x7fD6XLlD+z5C6zq/laNX/Mb31hByxw0cn/wXMTSUXjzAhRDmc9+JMaibcghWyVNPPiCDTlshacfa/u9AHMLIqME8JfOteKnhAkNAKI8pcFm2x+sVoSOKHHgU17VT9jIsJyv///DmIuGHEdnyJv1dlOJXECKfSRKE524DhOZLSPkXJp01IBHGwLWxaikTjDycKbXB7E7oyxShr5HpqjYLIGUpKtEKySTe/8QFEGfix3gzlnuE8NSNWYhXjJA5XL6E5pX2XeW0xiGzLkBFs2whtLqy2W5RkdB7cyLrjd1jKyyLKjNhcX5Ycz14AKobuIFu53zlB3gJf0SI3yypjJHRGqikUuVxJ9HKcTiclcYTDOc83m1LKxStmT5t5m7dK7p42vlwdCPokOjTeX7V/oTGUQx8zr4LF7YNYqUfq3vPZ6UPwANrbWoYBMA1p3kwPKIDSELlLn7p0oFoeKAy4gffAYzjjUckkuAVyZ0hKAXhlIu2M4tZooa4/bw20//WOO7lg4jQiCoTSPAJOs6HWUTJF+XlAC8I91rbMxXaatTSGb1AC/8LrSQxSIMbeUrRGA0GEDSFYnKxuAxPCC017uu9B3sazKX0kJwWM5PZYSYVy6w5RkvapS8+gYgLdTI5wCCzx0m1CtsoXp9Jo8Z89xdGYOhyA2bsRon4mpkDu73g==',
        },
        template: {
          metadata: {
            name: 'registry',
            namespace: 'kitty-krew-dev',
            creationTimestamp: null,
          },
          type: 'kubernetes.io/dockerconfigjson',
        },
      },
    })
    return apiObject
  }

  #createDeployment(): k8s.KubeDeployment {
    return new k8s.KubeDeployment(this, 'Deployment', {
      metadata: {
        name: 'kitty-krew',
        namespace: 'kitty-krew-dev',
      },
      spec: {
        selector: {
          matchLabels: {
            app: 'kitty-krew',
          },
        },
        replicas: 1,
        template: {
          metadata: {
            labels: {
              app: 'kitty-krew',
            },
          },
          spec: {
            serviceAccountName: 'kitty-krew-sa',
            imagePullSecrets: [
              {
                name: 'registry',
              },
            ],
            containers: [
              {
                name: 'kitty-krew',
                resources: {
                  limits: {
                    cpu: k8s.Quantity.fromString('300m'),
                    memory: k8s.Quantity.fromString('256Mi'),
                  },
                  requests: {
                    cpu: k8s.Quantity.fromString('100m'),
                    memory: k8s.Quantity.fromString('128Mi'),
                  },
                },
                env: [
                  {
                    name: 'NODE_ENV',
                    value: 'development',
                  },
                  {
                    name: 'LOG_LEVEL',
                    value: 'debug',
                  },
                  {
                    name: 'NODE_EXTRA_CA_CERTS',
                    value: '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
                  },
                ],
              },
            ],
          },
        },
      },
    })
  }
}

// When running this file directly
if (require.main === module) {
  const app = new App()
  new KittyKrewChart(app, 'kitty-krew')
  app.synth()
}
