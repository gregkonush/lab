# Sealed Secrets

[docs](https://github.com/bitnami-labs/sealed-secrets?tab=readme-ov-file#usage)

## Install kubeseal cli

```bash
brew install kubeseal
```

## Encode

```bash
echo -n 'bar' | base64
```

## Decode

```bash
echo -n 'YmFy' | base64 --decode
```

Example of `secret.yaml`

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: foo
  namespace: foonamespace
type: Opaque
data:
  password: YmFy
```

## Create sealed secret from secret

```bash
kubeseal --controller-name sealed-secrets -f secret.yaml -w sealed-password.yaml
```

## Check controller

```bash
kubectl get pods -n kube-system | grep sealed-secrets
kubectl get sealedsecrets
kubectl logs deployments/sealed-secrets -n kube-system
```

### Create dockerconfig.json

Create `auth`

```bash
echo -n 'user:password' | base64
```

Create `dockerconfig.json`

```json
{ "auths": { "gitea.proompteng.ai": { "auth": "dXNlcjpwYXNzd29yZA==" } } }
```

Encode json with `base64`

```bash
echo -n '{"auths":{"gitea.proompteng.ai":{"auth":"dXNlcjpwYXNzd29yZA=="}}}' | base64
```

Place output into secret yaml

```yaml
apiVersion: v1
kind: Secret
type: kubernetes.io/dockerconfigjson
metadata:
  name: gitea-registry
  namespace: ecran
data:
  .dockerconfigjson: eyJhdXRocyI6eyJnaXRlYS5wcm9vbXB0ZW5nLmFpIjp7ImF1dGgiOiJkWE5sY2pwd1lYTnpkMjl5WkE9PSJ9fX0=
```

Finally create a sealed-secret from plain text secret

```bash
kubeseal --controller-name sealed-secrets -f secret.yaml -w sealed-registry.yaml
```
