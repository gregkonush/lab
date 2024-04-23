# Sealed Secrets

[docs](https://github.com/bitnami-labs/sealed-secrets?tab=readme-ov-file#usage)

```bash
kubeseal --controller-name sealed-secrets -f secret.yaml -w sealed-secret.yaml
```

## Encode

```bash
echo -n 'bar' | base64
```

Example of `secret.yaml`

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: foo
type: Opaque
data:
  password: YmFy
```

## Decode

```bash
echo -n 'YmFy' | base64 --decode
```
