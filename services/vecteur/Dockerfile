# syntax=docker/dockerfile-upstream:master
FROM ghcr.io/cloudnative-pg/postgresql:16.4

ARG PGVECTORS_TAG
ARG TARGETARCH

# drop to root to install packages
USER root

# install pgvecto.rs
ADD https://github.com/tensorchord/pgvecto.rs/releases/download/${PGVECTORS_TAG}/vectors-pg14_${PGVECTORS_TAG#"v"}_${TARGETARCH}.deb ./pgvectors.deb
RUN apt install ./pgvectors.deb

USER postgres
