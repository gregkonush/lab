# rails-latest

Rails 8.0.3 API application backed by PostgreSQL (CloudNativePG) and Redis. The service exposes a `/health` endpoint for uptime checks and is designed to run in Kubernetes via Argo CD.

## Requirements

- Ruby 3.4.6 (local development installs via [`ruby-build`](https://github.com/rbenv/ruby-build) or similar)
- Bundler 2.7+
- PostgreSQL 14+ reachable by `DATABASE_URL`
- Redis 7+ reachable by `REDIS_URL`

## Setup

```bash
bundle install
# optional: configure .env or export environment variables
export DATABASE_URL=postgres://localhost/rails_latest_development
export REDIS_URL=redis://localhost:6379/1
bundle exec rails db:prepare
```

Run the server locally:

```bash
bundle exec rails server
```

## Tests

The test suite requires a reachable PostgreSQL database. Provide a test database URL before running:

```bash
export DATABASE_URL=postgres://localhost/rails_latest_test
bundle exec rails test
```

## Docker

Build the container image and run it locally:

```bash
docker build -t rails-latest:dev .
docker run --rm \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://postgres:postgres@postgres.example/rails_latest \
  -e REDIS_URL=redis://redis.example:6379/1 \
  -e RAILS_MASTER_KEY=... \
  rails-latest:dev
```

The container entrypoint runs `bundle exec rails db:prepare` on startup and serves Puma on `0.0.0.0:3000`.

## Health Check

- `GET /health` – returns `{ "status": "ok" }` when the application boots successfully.
