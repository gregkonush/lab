#!/bin/sh
set -eu

cli() {
  valkey-cli --no-auth-warning --raw -c --tls \
    --cacert /tls/ca.crt --cert /tls/tls.crt --key /tls/tls.key \
    --sni "$VALKEY_TLS_SERVER_NAME" --user "$VALKEY_USERNAME" \
    -h "$VALKEY_HOST" -p "$VALKEY_PORT" "$@"
}

# The native User controller applies the application ACL after cluster creation.
# Only this new credential is mounted; no broker or operator credential is used.
ready=false
attempt=1
while [ "$attempt" -le 60 ]; do
  info=$(cli CLUSTER INFO 2>/dev/null | tr -d '\r') || info=''
  if printf '%s\n' "$info" | grep -qx 'cluster_state:ok' &&
     printf '%s\n' "$info" | grep -qx 'cluster_slots_assigned:16384'; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 3
done
test "$ready" = true
printf '%s\n' "$info" | grep -E '^cluster_(state|slots_assigned|slots_ok|known_nodes|size):'

# Multiple hash tags exercise cluster-client redirections, not only one shard.
for tag in 0 1 2 3 4 5 6 7 8 9 10 11; do
  key="bayn:acceptance:{$tag}:${TEST_RUN_ID:?}"
  test "$(cli SET "$key" verified EX 600)" = OK
  test "$(cli GET "$key")" = verified
  test "$(cli DEL "$key")" = 1
done
echo 'PASS: TLS-authenticated cluster writes, reads and deletion across hash tags'

# Do not perform destructive negative tests such as FLUSHALL.
denied=$(cli GET forbidden:acceptance 2>&1) || true
printf '%s\n' "$denied" | grep -q NOPERM
echo 'PASS: application ACL rejects keys outside bayn:*'

unauthenticated=$(REDISCLI_AUTH='' cli GET 'bayn:acceptance:unauthenticated' 2>&1) || true
printf '%s\n' "$unauthenticated" | grep -Eq 'NOAUTH|WRONGPASS'
echo 'PASS: requests without the application password are rejected'
