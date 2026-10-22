# Knative Eventing

The Knative operator owns core Eventing at version 1.23.0. The pinned Kafka controller, source, and sink manifests
provide KafkaSource admission/conversion and Kafka-backed event delivery. Argo tracks reviewed `main` for this
application. Agents configuration and images follow the `agents` Kargo Stage.

## Webhook resources

`kafka-webhook-resources.patch.yaml` gives the Kafka webhook a 1 CPU / 512 MiB limit, with 100m CPU / 256 MiB requests.
The previous 200m / 200 MiB limits caused CPU throttling and probe-triggered restarts. The startup probe allows two
minutes to initialize. Readiness and liveness continue to probe the admission endpoint with longer timeouts.

## Codex GitHub delivery

The Agents KafkaSource consumes the shared `github.webhook.events` topic. The receiver projects supported CI and
review events and acknowledges recognized irrelevant `ping`, `push`, `workflow_run`, and `workflow_job` events.
Unrecognized event metadata remains an error.

After five retries with exponential backoff, failed deliveries go to the Agents KafkaSink and the replicated
`agents.codex.github.events.dlq` topic. Kafka retains these structured CloudEvents for seven days. The topic has
pruning and deletion protection. The original shared topic and consumer group remain intact.

External Secrets formats the existing reflected Codex Kafka credentials for KafkaSink and refreshes the derived
Secret every minute. Its reader can get only the two existing credential Secrets. The upstream sink data plane uses
its dedicated service account and upstream secret-read/EventType permissions.

## Rollout and verification

1. Sync the reviewed Kafka topic and Knative Eventing changes. Wait for KafkaTopic readiness and the sink receiver
   deployment.
2. Let the Agents main build publish eligible images and Kargo promote the exact source commit to `kargo/agents`.
   The Agents sync waves create the credential reader, SecretStore, ExternalSecret, and KafkaSink before updating
   KafkaSource delivery.
3. Run `python3 scripts/agents/verify-kafka-eventing.py --context galactic-lan --publish-probes` from the repository
   root with cluster access and internal service DNS. It verifies conversion, ignored/rejected event handling, a
   Kafka check event updating a temporary projection, and a rejected record reaching the dead-letter topic. The
   script deletes its temporary projection and leaves its labeled synthetic Kafka records under normal retention.

Inspect the dead-letter topic through Kafka UI before replay. Preserve the original CloudEvent metadata when
replaying a repaired event. Follow the normal Kargo recovery path to revert Agents behavior. Revert the webhook patch
through reviewed GitOps if required. Preserve the protected dead-letter topic during recovery.
