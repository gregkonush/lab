#!/bin/bash
set -euo pipefail

IMAGE_NAME="registry.ide-newton.ts.net/lab/bonjour"
DOCKERFILE="packages/bonjour/Dockerfile"
CONTEXT_PATH="."

TAG="${1:-$(git rev-parse --short HEAD)}"
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

echo "[bonjour] Building and pushing ${FULL_IMAGE_NAME}"
docker buildx build \
  --platform linux/arm64 \
  --file "${DOCKERFILE}" \
  --tag "${FULL_IMAGE_NAME}" \
  "${CONTEXT_PATH}" \
  --push

echo "[bonjour] Image published: ${FULL_IMAGE_NAME}"
