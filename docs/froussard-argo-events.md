# Froussard ⇄ Argo Events Integration Notes

## Summary

- **Updated** `argocd/applications/froussard/github-codex-echo-sensor.yaml:43` so that the
  sensor's trigger parameters live under `template.k8s.parameters`. This ensures Argo Events
  mutates the Kubernetes Workflow resource with the CloudEvent payload instead of modifying
  the trigger template structure.
- **Result**: Workflows spawned by the sensor now receive the full webhook JSON payload in
  `spec.arguments.parameters[0]` (`rawEvent`) and `spec.arguments.parameters[1]` (`eventBody`),
  eliminating the previous `{}` values.

## Verification Steps

1. Apply the manifests and allow the `github-codex-echo` sensor deployment to roll.
2. Open a GitHub issue in `gregkonush/lab` to emit a webhook.
3. Inspect the latest workflow with:
   ```bash
   kubectl get wf -n argo-workflows github-codex-echo-<suffix> -o jsonpath='{.spec.arguments.parameters[*].value}'
   ```
4. Confirm the logged payload via:
   ```bash
   kubectl logs -n argo-workflows github-codex-echo-<suffix> -c main
   ```
