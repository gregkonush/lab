# Miel (Alpaca Backtesting Service)

This directory defines the Kubernetes manifests synced by Argo CD for the `miel` trading/backtest service.

## Components

- `ConfigMap` (`miel-config`) — default non-secret configuration values such as Alpaca endpoints and request limits.
- `Deployment` — runs the Go service image `registry.ide-newton.ts.net/lab/miel:0.1.0`, exposing port 8080 with readiness/liveness probes on `/healthz`.
- `Service` — stable ClusterIP service on port 80 pointing to the container’s port 8080.

## Secrets

The deployment expects a `Secret` named `miel-secrets` in the same namespace with keys:

- `alpaca-api-key`
- `alpaca-secret-key`

Provision these via SealedSecrets or your preferred secret management flow. The values populate the `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` environment variables.

## Image Updates

Use `scripts/build-miel.sh <tag>` to build and push a new container image. Update the `image` field in `deployment.yaml` (or manage via Argo CD Image Updater) to roll out the new version.
