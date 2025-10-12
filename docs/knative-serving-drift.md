# Knative Service Drift Checklist

The last two service rollouts (Dernier and Facteur) both surfaced the same
problem: we bounced a Knative service with `kn service update`, reconciled
cleanly, and then Argo CD immediately flagged the resource as **OutOfSync**.
Each time the manifest in `argocd/applications/<app>/base/kservice.yaml`
was missing a couple of defaulted fields that the Knative Serving controller
hydrates on every revision. When we forget to capture those defaults, every
Argo refresh looks like someone mutated production by hand.

Going forward, treat this note as the source of truth for Knative manifests.

---

## Required fields to keep manifests stable

Always record the following in the manifest (even if they seem redundant):

- `spec.template.spec.containers[].ports[].protocol`
  - Knative defaults to `TCP`, but Argo will keep reporting drift unless it is
    explicit.
- `spec.template.spec.containers[].readinessProbe` thresholds
  - Default values inserted by Knative:
    - `failureThreshold: 3`
    - `successThreshold: 1`
    - `timeoutSeconds: 1`
  - We already set `httpGet`, `initialDelaySeconds`, and `periodSeconds` in the
    repo; make sure the thresholds and timeout are present as well.
- If you ever rely on other defaults (for example `containerConcurrency` or
  `timeoutSeconds`) copy them into the manifest before opening a PR.

Knative will also drop an annotation (`client.knative.dev/updateTimestamp`) and
apply `enableServiceLinks: false`. These can safely be ignored—Argo tolerates
them because we manage the whole `spec.template` block. Only the fields above
cause a drift loop.

---

## Recommended workflow

1. Update the YAML manifest first.
2. Redeploy with the manifest (avoid ad-hoc `kn service update` during review):
   ```bash
   kubectl apply -k argocd/applications/<app>/overlays/cluster
   ```
3. If an emergency fix *requires* running `kn service update`, immediately
   export the hydrated spec afterwards:
   ```bash
   kubectl get ksvc <app> -n <namespace> -o yaml > /tmp/ksvc.yaml
   ```
   Diff it against `base/kservice.yaml` and copy any new defaults back into the
   repo before committing.
4. Double-check with `argocd app diff <app>` (or the web UI) before merging.

Following this checklist keeps Knative, Argo CD, and the repo in sync and saves
us from firefighting noisy drift alerts the next time someone bumps an image.
