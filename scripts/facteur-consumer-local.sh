#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/services/facteur/config/example.yaml}"

echo "Starting facteur consumer with config ${CONFIG_PATH}" >&2

cd "$ROOT_DIR/services/facteur"
GOFLAGS=${GOFLAGS:-} go run . consume --config "$CONFIG_PATH"
