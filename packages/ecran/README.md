# Ecran

Frontend of proompteng.ai

Install default namespace on temporal

Port forward temporal-frontend-headless from temporal

```bash
kubectl port-forward svc/temporal-frontend-headless 7233:7233
```

Install temporal cli

```bash
brew install temporal
```

Run a curl to temporal to create default namespace

```bash
temporal operator namespace create default
```
