# Release Branch Auto-PR Workflow

This workflow opens pull requests when Argo CD Image Updater commits to a `release/<app>` branch or when the workflow is manually dispatched.

## Enrolling a New Application

1. Configure the application's Argo CD manifests with the Image Updater annotations that target a `release/<app>` branch.
2. Update [`.github/workflows/auto-pr-release-branches.yml`](../.github/workflows/auto-pr-release-branches.yml):
   - Add the application name to the `workflow_dispatch.inputs.app.options` list so the manual release action can target it.
   - Confirm any branch-specific logic in the shell script recognizes the new branch (most simply follow the `release/<app>` naming convention).
3. Push a change to the `release/<app>` branch (or trigger the workflow manually) to verify that a pull request is created.

## Formatting Notes

- Use single quotes for all YAML string literals in `.github/workflows/auto-pr-release-branches.yml` to keep quoting consistent and avoid escaping GitHub expressions like `${{ ... }}`.
- Run `pnpm run format` before committing if you make broader changes that touch project code; the workflow file is not autoformatted, so keep it tidy by hand.

This documentation helps ensure the `workflow_dispatch` options stay synchronized with the applications managed by Argo CD Image Updater.
