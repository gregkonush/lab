FROM debian:bullseye-slim AS builder

# use the advice from here https://cloudnative-pg.io/blog/creating-container-images/
# but also add in the deps for, and use, the AGE repo (https://age.apache.org/getstarted/quickstart/)
RUN set -xe ;\
  apt update && apt install wget lsb-release gnupg2 -y ;\
  sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' ;\
  wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - ;\
  apt-get update ;\
  apt-get install -y postgresql-server-dev-16 build-essential git libreadline-dev zlib1g-dev flex bison; \
  cd /tmp; \
  git clone https://github.com/apache/age.git; \
  cd /tmp/age; \
  PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config make; \
  PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config make install

FROM ghcr.io/cloudnative-pg/postgresql:16

USER root

COPY --from=builder /usr/lib/postgresql/16/lib/age.so /usr/lib/postgresql/16/lib/
COPY --from=builder /usr/share/postgresql/16/extension/age.control /usr/share/postgresql/16/extension/
COPY --from=builder /usr/share/postgresql/16/extension/age--1.5.0.sql /usr/share/postgresql/16/extension/

RUN set -xe; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  "postgresql-16-pgvector" ; \
  rm -fr /tmp/* ; \
  rm -rf /var/lib/apt/lists/*;


RUN usermod -u 26 postgres
USER 26
