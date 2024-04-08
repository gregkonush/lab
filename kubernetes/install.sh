#!/bin/sh

echo "Setting up primary server 1"
k3sup install --host 192.168.1.150 \
--user kalmyk \
--cluster \
--local-path kubeconfig \
--context default

echo "Fetching the server's node-token into memory"

export NODE_TOKEN=$(k3sup node-token --host 192.168.1.150 --user kalmyk)

echo "Setting up additional server: 2"
k3sup join \
--host 192.168.1.151 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up additional server: 3"
k3sup join \
--host 192.168.1.152 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up additional server: 4"
k3sup join \
--host 192.168.1.153 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up additional server: 5"
k3sup join \
--host 192.168.1.154 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 1"
k3sup join \
--host 192.168.1.160 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 2"
k3sup join \
--host 192.168.1.161 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 3"
k3sup join \
--host 192.168.1.162 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 4"
k3sup join \
--host 192.168.1.163 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 5"
k3sup join \
--host 192.168.1.164 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 6"
k3sup join \
--host 192.168.1.165 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 7"
k3sup join \
--host 192.168.1.166 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 8"
k3sup join \
--host 192.168.1.167 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 9"
k3sup join \
--host 192.168.1.168 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

echo "Setting up worker: 10"
k3sup join \
--host 192.168.1.169 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk

