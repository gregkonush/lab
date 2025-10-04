# Nginx Proxy Manager (NUC)

Snapshot of the running configuration for the home Nginx Proxy Manager instance. Sensitive artifacts (`data/database.sqlite`, `data/keys.json`, full LetsEncrypt tree) are intentionally excluded; copy them from the live host before running if you need the existing proxy records.

## Layout

```
devices/nuc/nginx-proxy-manager/
├── docker-compose.yaml
├── data/                  # exported from /data inside the container (sqlite DB, nginx conf, etc.)
└── .gitignore              # excludes letsencrypt certs and runtime logs
```

`data/letsencrypt-acme-challenge/` is retained so HTTP challenges work when the container recreates certificates. The `letsencrypt/` directory is intentionally ignored—place the real certs there out-of-band.

## Refreshing the snapshot

```bash
ssh kalmyk@192.168.1.130
cd ~/github.com/homelab/nuc/nginx-proxy-manager
 tar czf npm-config-$(date +%Y%m%d).tgz docker-compose.yml data
scp kalmyk@192.168.1.130:~/github.com/homelab/nuc/nginx-proxy-manager/npm-config-YYYYMMDD.tgz .
```

On your workstation:

```bash
rm -rf devices/nuc/nginx-proxy-manager
mkdir -p devices/nuc/nginx-proxy-manager
 tar xzf npm-config-YYYYMMDD.tgz -C devices/nuc/nginx-proxy-manager --strip-components=0
rm -rf devices/nuc/nginx-proxy-manager/data/logs devices/nuc/nginx-proxy-manager/letsencrypt
```

Commit the updated `docker-compose.yaml` and `data/` contents; keep certificates out of Git.
