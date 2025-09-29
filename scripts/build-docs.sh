#!/bin/bash

# Set variables
IMAGE_NAME="registry.ide-newton.ts.net/lab/docs"
DOCKERFILE="apps/docs/Dockerfile"
CONTEXT_PATH="."

# Check if a tag is provided as an argument
if [ $# -eq 1 ]; then
    TAG=$1
else
    # If no tag is provided, use the current date and time
    TAG=$(date +"%Y%m%d_%H%M%S")
fi

# Full image name with tag
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

# Determine whether to push or load locally
if [ "${SKIP_PUSH:-0}" = "1" ]; then
    BUILD_OUTPUT="--load"
    PLATFORM=""
    echo "Building Docker image locally without pushing (SKIP_PUSH=1)."
else
    BUILD_OUTPUT="--push"
    PLATFORM="--platform linux/arm64"
    echo "Building and pushing Docker image: ${FULL_IMAGE_NAME}"
fi

# Build the Docker image
docker buildx build ${PLATFORM} -t ${FULL_IMAGE_NAME} -f ${DOCKERFILE} ${CONTEXT_PATH} ${BUILD_OUTPUT}

# Check if the build was successful
if [ $? -eq 0 ]; then
    if [ "${SKIP_PUSH:-0}" = "1" ]; then
        echo "Docker image built and loaded locally: ${FULL_IMAGE_NAME}"
    else
        echo "Docker image built and pushed successfully: ${FULL_IMAGE_NAME}"
    fi
else
    echo "Docker image build or push failed"
    exit 1
fi
