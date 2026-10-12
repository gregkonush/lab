# syntax=docker/dockerfile:1
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /opt/bayn-model
COPY runtime.py serve.py admission.py model-lock.json ./
USER 10001:10001
ENTRYPOINT ["python3", "/opt/bayn-model/runtime.py"]

FROM runtime AS test
COPY test_runtime.py test_admission.py ./
RUN python3 -m unittest -v test_runtime.py test_admission.py
