#!/bin/bash

# Set variables
IMAGE_NAME="kalmyk.duckdns.org/lab/ecran-migrator"
DOCKERFILE="services/ecran/Dockerfile.migrator"
CONTEXT_PATH="services/ecran"

# Check if a tag is provided as an argument
if [ $# -eq 1 ]; then
    TAG=$1
else
    # If no tag is provided, use the current date and time
    TAG=$(date +"%Y%m%d_%H%M%S")
fi

# Full image name with tag
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

# Build the Docker image
echo "Building Docker image: ${FULL_IMAGE_NAME}"
docker buildx build --platform linux/arm64 -t ${FULL_IMAGE_NAME} -f ${DOCKERFILE} ${CONTEXT_PATH} --push

# Check if the build was successful
if [ $? -eq 0 ]; then
    echo "Docker image built and pushed successfully: ${FULL_IMAGE_NAME}"
else
    echo "Docker image build or push failed"
    exit 1
fi
