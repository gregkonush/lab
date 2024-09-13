#!/bin/sh

echo "Setting up primary server 1"
k3sup install --host 192.168.1.150 \
  --user kalmyk \
  --cluster \
  --local-path kubeconfig \
  --ssh-key ~/.ssh/id_ed25519 \
  --context default

echo "Fetching the server's node-token into memory"

NODE_TOKEN=$(k3sup node-token --host 192.168.1.150 --user kalmyk)
export NODE_TOKEN

echo "Setting up additional server: 2"
k3sup join \
  --host 192.168.1.151 \
  --server-host 192.168.1.150 \
  --server \
  --node-token "$NODE_TOKEN" \
  --ssh-key ~/.ssh/id_ed25519 \
  --user kalmyk

echo "Setting up additional server: 3"
k3sup join \
  --host 192.168.1.152 \
  --server-host 192.168.1.150 \
  --server \
  --node-token "$NODE_TOKEN" \
  --ssh-key ~/.ssh/id_ed25519 \
  --user kalmyk

# Worker nodes setup
for i in {0..8}
do
  echo "Setting up worker: $((i+1))"
  k3sup join \
    --host "192.168.1.$((160+i))" \
    --server-host 192.168.1.150 \
    --node-token "$NODE_TOKEN" \
    --ssh-key ~/.ssh/id_ed25519 \
    --user kalmyk
done
