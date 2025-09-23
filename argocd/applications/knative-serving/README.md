# Knative Serving

## Configuration

### cert-manager Integration

Knative Serving is configured to use cert-manager for TLS certificate provisioning through the `letsencrypt-prod` ClusterIssuer. This enables automatic HTTPS for Knative services.

The integration uses the Let's Encrypt production issuer with HTTP01 challenges terminated by the Istio ingress gateway that Knative is pinned to.

**Important settings:**

- External Domain TLS: `Enabled` - Automatically provisions certificates for external domains via cert-manager
- Ingress: `Istio` - Knative net-istio is the only enabled ingress implementation
- ClusterIssuer: `letsencrypt-prod` - Uses Let's Encrypt production with HTTP01 challenges through Istio
- Domain Template: `{{.Name}}.{{.Domain}}` - Routes render as single-level subdomains (e.g., `froussard.proompteng.ai`)

**Reference:** [Knative cert-manager integration](https://knative.dev/docs/serving/encryption/configure-certmanager-integration/)
