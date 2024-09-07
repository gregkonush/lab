#!/usr/bin/env bash

docker buildx build --platform linux/arm64 -t gitea.proompteng.ai/lab/ecran:latest ./apps/ecran --file ./apps/ecran/Dockerfile --push
