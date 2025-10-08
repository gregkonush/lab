# facteur

`facteur` is a Go service that will mediate Discord bot commands into Argo workflow executions. This directory currently contains the CLI scaffolding, configuration layer, and deployment manifests that future work will extend with real integrations. See `docs/facteur-discord-argo.md` for the end-to-end architecture and configuration contract.

## Layout

- `cmd/facteur`: Cobra-based CLI entrypoints.
- `internal`: Internal packages that will house configuration, Discord routing, Argo bridge logic, and session storage.
- `config`: Example configuration files and schema references (role map schema lives at `schemas/facteur-discord-role-map.schema.json`).
- `Dockerfile`: Multi-stage build for containerizing the service.

Refer to the repository docs for detailed integration guidance and follow-up tasks.
