# syntax=docker/dockerfile:1
# check=error=true

ARG RUBY_VERSION=3.3.4
FROM docker.io/library/ruby:${RUBY_VERSION}-slim AS base

ENV APP_HOME=/rails \
    BUNDLE_PATH=/bundle \
    BUNDLE_DEPLOYMENT=1 \
    BUNDLE_WITHOUT=development:test \
    RAILS_ENV=production

WORKDIR ${APP_HOME}

RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y curl libjemalloc2 libpq5 libvips postgresql-client \
 && rm -rf /var/lib/apt/lists /var/cache/apt/archives

FROM base AS build

RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y build-essential git libpq-dev libyaml-dev pkg-config \
 && rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY Gemfile Gemfile.lock ./
RUN bundle install --jobs=4 --retry=3 \
 && bundle exec bootsnap precompile --gemfile

COPY . .
RUN bundle exec bootsnap precompile app/ lib/

FROM base AS app

ENV PORT=3000 \
    RAILS_LOG_TO_STDOUT=1

COPY --from=build /bundle /bundle
COPY --from=build ${APP_HOME} ${APP_HOME}

RUN groupadd --system --gid 1000 rails \
 && useradd --home-dir /home/rails --create-home --uid 1000 --gid 1000 --shell /bin/bash rails \
 && chown -R rails:rails ${APP_HOME} /bundle

USER 1000:1000

WORKDIR ${APP_HOME}

ENV PATH="${APP_HOME}/bin:${PATH}"

EXPOSE 3000

ENTRYPOINT ["/rails/bin/entrypoint"]
