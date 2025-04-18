#!/bin/sh

echo "Setting up primary server 1"
k3sup install --host 192.168.1.150 \
--user kalmyk \
--cluster \
--local-path $HOME/.kube/config \
--context default \
--k3s-extra-args "--disable servicelb" \
--ssh-key $HOME/.ssh/id_ed25519

echo "Fetching the server's node-token into memory"

export NODE_TOKEN=$(k3sup node-token --host 192.168.1.150 --user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519)

echo "Setting up additional server: 2"
k3sup join \
--host 192.168.1.151 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--k3s-extra-args "--disable servicelb" \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up additional server: 3"
k3sup join \
--host 192.168.1.152 \
--server-host 192.168.1.150 \
--server \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--k3s-extra-args "--disable servicelb" \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 1"
k3sup join \
--host 192.168.1.160 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 2"
k3sup join \
--host 192.168.1.161 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 3"
k3sup join \
--host 192.168.1.162 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 4"
k3sup join \
--host 192.168.1.163 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 5"
k3sup join \
--host 192.168.1.164 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 6"
k3sup join \
--host 192.168.1.165 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 7"
k3sup join \
--host 192.168.1.166 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 8"
k3sup join \
--host 192.168.1.167 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 9"
k3sup join \
--host 192.168.1.168 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 10"
k3sup join \
--host 192.168.1.169 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 11"
k3sup join \
--host 192.168.1.170 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 12"
k3sup join \
--host 192.168.1.171 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 13"
k3sup join \
--host 192.168.1.172 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 14"
k3sup join \
--host 192.168.1.173 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 15"
k3sup join \
--host 192.168.1.174 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 16"
k3sup join \
--host 192.168.1.175 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 17"
k3sup join \
--host 192.168.1.176 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 18"
k3sup join \
--host 192.168.1.177 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 19"
k3sup join \
--host 192.168.1.178 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 20"
k3sup join \
--host 192.168.1.179 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 21"
k3sup join \
--host 192.168.1.180 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 22"
k3sup join \
--host 192.168.1.181 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 23"
k3sup join \
--host 192.168.1.182 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 24"
k3sup join \
--host 192.168.1.183 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 25"
k3sup join \
--host 192.168.1.184 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 26"
k3sup join \
--host 192.168.1.185 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 27"
k3sup join \
--host 192.168.1.186 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 28"
k3sup join \
--host 192.168.1.187 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 29"
k3sup join \
--host 192.168.1.188 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

echo "Setting up worker: 30"
k3sup join \
--host 192.168.1.189 \
--server-host 192.168.1.150 \
--node-token "$NODE_TOKEN" \
--user kalmyk \
--ssh-key $HOME/.ssh/id_ed25519 &

