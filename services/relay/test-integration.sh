#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
fixture_dir="$(mktemp -d /tmp/relay-fixture.XXXXXX)"
fixture_pg_bin="${PG_BINDIR:-$(pg_config --bindir)}"
cleanup() {
  "$fixture_pg_bin/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
fixture_port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 -subj '/CN=Relay disposable CA' \
  -keyout "$fixture_dir/ca.key" -out "$fixture_dir/ca.crt" >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=provider.example' \
  -keyout "$fixture_dir/server.key" -out "$fixture_dir/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:provider.example,DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > "$fixture_dir/server.ext"
openssl x509 -req -in "$fixture_dir/server.csr" -CA "$fixture_dir/ca.crt" -CAkey "$fixture_dir/ca.key" \
  -CAcreateserial -days 1 -sha256 -extfile "$fixture_dir/server.ext" -out "$fixture_dir/server.crt" >/dev/null 2>&1
chmod 600 "$fixture_dir/server.key"
printf 'disposable-relay-password' > "$fixture_dir/password"
"$fixture_pg_bin/initdb" -D "$fixture_dir/data" -U relay_schema_owner --auth-local=trust --auth-host=scram-sha-256 --pwfile="$fixture_dir/password" >/dev/null
"$fixture_pg_bin/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/postgres.log" \
  -o "-h 127.0.0.1 -p $fixture_port -k $fixture_dir -c ssl=on -c ssl_cert_file=$fixture_dir/server.crt -c ssl_key_file=$fixture_dir/server.key" -w start >/dev/null
"$fixture_pg_bin/psql" -h "$fixture_dir" -p "$fixture_port" -U relay_schema_owner -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE relay_runtime LOGIN PASSWORD 'disposable-relay-password'" -c 'CREATE DATABASE relay_fixture OWNER relay_schema_owner' >/dev/null
export RELAY_TEST_DSN="host=localhost hostaddr=127.0.0.1 port=$fixture_port dbname=relay_fixture user=relay_schema_owner sslmode=require"
export RELAY_TEST_CA_FILE="$fixture_dir/ca.crt"
export RELAY_TEST_CERT_FILE="$fixture_dir/server.crt"
export RELAY_TEST_KEY_FILE="$fixture_dir/server.key"
export RELAY_TEST_PASSWORD_FILE="$fixture_dir/password"
cargo test --locked --lib integration:: -- --ignored --nocapture
