#!/bin/bash

# Set variables
IMAGE_NAME="kalmyk.duckdns.org/lab/kitty-krew"
DOCKERFILE="Dockerfile"
CONTEXT_PATH="apps/kitty-krew"

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
docker buildx build --platform linux/arm64 -t ${FULL_IMAGE_NAME} -f ${CONTEXT_PATH}/${DOCKERFILE} ${CONTEXT_PATH} --push

# Check if the build was successful
if [ $? -eq 0 ]; then
    echo "Docker image built and pushed successfully: ${FULL_IMAGE_NAME}"

    # Print instructions for updating kustomization
    echo ""
    echo "To update the application deployment, edit the kustomization.yaml in your environment overlay:"
    echo "--------------------------------------------------------"
    echo "images:"
    echo "  - name: kitty-krew"
    echo "    newName: ${IMAGE_NAME}"
    echo "    newTag: ${TAG}"
    echo "--------------------------------------------------------"

    # Automatically run the container locally for testing
    echo ""
    echo "Running container locally for testing..."
    docker pull ${FULL_IMAGE_NAME}

    echo "Starting container with --rm flag (will be removed after stopping)..."
    docker run --rm -d -p 3000:3000 --name kitty-krew-test ${FULL_IMAGE_NAME}

    if [ $? -eq 0 ]; then
        echo "Container is running! Access it at: http://localhost:3000"
        echo "To stop the container: docker stop kitty-krew-test"

        # Wait for the container to initialize
        echo "Waiting for application to start..."
        sleep 5

        # Test the application with curl
        echo "Testing application health endpoint..."
        HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)

        if [ "$HEALTH_CHECK" == "200" ]; then
            echo "✅ Health check successful! Application is running properly."
            echo "Response from /health endpoint:"
            curl -s http://localhost:3000/health
            echo ""
        else
            echo "⚠️ Health check returned status code: $HEALTH_CHECK"
            echo "The container is running but the application might not be fully initialized yet."
            echo "Try manually checking the endpoints after a few more seconds."
        fi
    else
        echo "Failed to run the container"
    fi
else
    echo "Docker image build or push failed"
    exit 1
fi
