# Release Branch Auto-PR Workflow

This workflow opens pull requests when Argo CD Image Updater commits to a `release/<app>` branch or when the workflow is manually dispatched.

## Enrolling a New Application

1. Configure the application's Argo CD manifests with the Image Updater annotations that target a `release/<app>` branch.
2. Update [`.github/workflows/auto-pr-release-branches.yml`](../.github/workflows/auto-pr-release-branches.yml):
   - Add the application name to the `workflow_dispatch.inputs.app.options` list so the manual release action can target it.
   - Confirm any branch-specific logic in the shell script recognizes the new branch (most simply follow the `release/<app>` naming convention).
3. Push a change to the `release/<app>` branch (or trigger the workflow manually) to verify that a pull request is created.

## Enabling Docker Image Publishing

When a new application should ship a container image, mirror its registration in [`.github/workflows/docker-build-push.yaml`](../.github/workflows/docker-build-push.yaml).

1. Add the application under the `dorny/paths-filter` step so that commits touching its source trigger a build.
2. Confirm the workflow declares explicit `permissions:` at the top level (for example `contents: read`) and only grants broader access to the individual jobs that require it.
3. If the app is Next.js-based, set `output: 'standalone'` in `next.config.mjs` so the build generates the `/standalone` server bundle consumed by the Dockerfile.
4. Create a `build-<app>` job that calls `docker-build-common.yaml` with the application's image name, Dockerfile path, and build context.
5. Append the job to the `cleanup-release` `needs` list so failed builds automatically roll back the tag and release.

This keeps the continuous delivery release tagging and the image publishing workflow in sync whenever a new app comes online.

## Formatting Notes

- Use single quotes for all YAML string literals in `.github/workflows/auto-pr-release-branches.yml` to keep quoting consistent and avoid escaping GitHub expressions like `${{ ... }}`.
- Run `pnpm run format` before committing if you make broader changes that touch project code; the workflow file is not autoformatted, so keep it tidy by hand.

This documentation helps ensure the `workflow_dispatch` options stay synchronized with the applications managed by Argo CD Image Updater.
