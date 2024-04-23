#!/usr/bin/env bash

docker buildx build -t gitea.proompteng.ai/gitbot/lab/ecran:latest ./apps/ecran --file ./apps/ecran/Dockerfile
docker push gitea.proompteng.ai/gitbot/lab/ecran:latest
