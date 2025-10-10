#!/bin/bash

# Set variables
IMAGE_NAME="registry.ide-newton.ts.net/lab/vecteur"
DOCKERFILE="services/vecteur/Dockerfile"
CONTEXT_PATH="services/vecteur"
DEFAULT_TAG="pg18-trixie"
TARGETARCH="arm64"

# Check if a tag is provided as an argument
if [ $# -eq 1 ]; then
    TAG=$1
else
    TAG="${DEFAULT_TAG}"
fi

# Full image name with tag
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

# Build the Docker image
echo "Building Docker image: ${FULL_IMAGE_NAME}"
if docker buildx build \
    --platform "linux/${TARGETARCH}" \
    -t "${FULL_IMAGE_NAME}" \
    -f "${DOCKERFILE}" "${CONTEXT_PATH}" \
    --push; then
    echo "Docker image built and pushed successfully: ${FULL_IMAGE_NAME}"
else
    echo "Docker image build or push failed"
    exit 1
fi
