# Knative Serving

## Configuration

### cert-manager Integration

Knative Serving is configured to use cert-manager for TLS certificate provisioning through the `letsencrypt-prod` ClusterIssuer. This enables automatic HTTPS for Knative services.

The integration uses the Let's Encrypt production issuer with HTTP01 challenges handled by Traefik.

**Important settings:**

- External Domain TLS: `Enabled` - Automatically provision certificates for external domains
- ClusterIssuer: `letsencrypt-prod` - Uses Let's Encrypt production with HTTP01 challenges

**Reference:** [Knative cert-manager integration](https://knative.dev/docs/serving/encryption/configure-certmanager-integration/)
