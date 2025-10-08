# Courriel

Courriel consumes the `argo.workflows.completions` Kafka topic and delivers workflow completion
notifications through Resend email. The service validates its environment configuration with Zod,
formats contextual email bodies, and guards against duplicate deliveries using idempotency keys.

## Environment

| Variable | Description |
| --- | --- |
| `KAFKA_BROKERS` | Comma-separated Kafka broker list, e.g. `broker-0:9092,broker-1:9092`. |
| `KAFKA_CLIENT_ID` | Client identifier used when connecting to Kafka. |
| `KAFKA_GROUP_ID` | Consumer group id for the courriel worker. |
| `KAFKA_TOPIC` | Source topic name (defaults to `argo.workflows.completions`). |
| `KAFKA_USERNAME` | SASL username provisioned in `kafka-codex-credentials`. |
| `KAFKA_PASSWORD` | SASL password provisioned in `kafka-codex-credentials`. |
| `KAFKA_SASL_MECHANISM` | Optional SASL mechanism (`scram-sha-512`, `scram-sha-256`, or `plain`). Defaults to `scram-sha-512`. |
| `KAFKA_USE_SSL` | Optional flag (`true`/`false`) to enable TLS. Defaults to `true`. |
| `RESEND_API_KEY` | Resend API key. Must be stored in the target namespace secret. |
| `RESEND_FROM` | Default `from` header, e.g. `Courriel <courriel@example.com>`. |
| `RESEND_TO` | Optional comma-separated fallback recipient list. |
| `COURIEL_SUBJECT_PREFIX` | Optional subject prefix (e.g. `[Argo]`). |
| `COURIEL_LOG_LEVEL` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`). Defaults to `info`. |

Workflow authors can provide overrides through annotations:

- `courriel/email-to`, `courriel/email-cc`, `courriel/email-bcc` for recipient targeting
- `courriel/email-from` and `courriel/email-reply-to` for sender metadata
- `courriel/email-subject` to replace the generated subject

The repository ships `fixtures/argo-completion.json`, a redacted completion payload used by the
Vitest suite and for manual testing.

## Local Development

```bash
pnpm --filter courriel install
pnpm --filter courriel exec tsc --noEmit
pnpm --filter courriel test
pnpm --filter courriel start
```

The `start` script runs the TypeScript entrypoint via `tsx` and expects the required environment
variables to be present.

## Container Image

A slim Node 22 image is provided in `Dockerfile`. It installs only the dependencies required for the
`courriel` workspace and executes the service with `pnpm --filter courriel start`.
