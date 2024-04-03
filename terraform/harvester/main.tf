terraform {
  required_providers {
    harvester = {
      source  = "harvester/harvester"
      version = ">= 0.6.4"
    }
  }
  backend "pg" {
    conn_str = "postgres://altra:@nuc.lan:5432/altra?sslmode=disable"
  }
}

provider "harvester" {
  kubeconfig = "~/.kube/altra.yaml"
}

resource "harvester_image" "ubuntu-focal" {
  name         = "ubuntu-focal"
  display_name = "Ubuntu 20 Focal LTS"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-arm64.img"
}

resource "harvester_image" "ubuntu-jammy" {
  name         = "ubuntu-jammy"
  display_name = "Ubuntu 22 Jammy LTS"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-arm64.img"
}

data "harvester_clusternetwork" "mgmt" {
  name = "mgmt"
}

resource "harvester_network" "cluster_network" {
  cluster_network_name = data.harvester_clusternetwork.mgmt.name
  name                 = "cluster-network"
  vlan_id              = 1
}

resource "harvester_virtualmachine" "rancher2" {
  name   = "rancher2"
  cpu    = 2
  memory = "2Gi"

  efi          = true
  hostname     = "rancher2"
  run_strategy = "RerunOnFailure"

  disk {
    name        = "root"
    type        = "disk"
    size        = "20Gi"
    bus         = "virtio"
    auto_delete = true
    boot_order  = 1
    image       = harvester_image.ubuntu-jammy.id
  }

  network_interface {
    name           = "bridge"
    model          = "virtio"
    type           = "bridge"
    mac_address    = "00:16:3E:3C:0E:FC"
    network_name   = harvester_network.cluster_network.name
    wait_for_lease = true
  }

  cloudinit {
    user_data_secret_name    = harvester_cloudinit_secret.ubuntu-cloud-config.name
    network_data_secret_name = harvester_cloudinit_secret.ubuntu-cloud-config.name
  }
}

resource "harvester_cloudinit_secret" "ubuntu-cloud-config" {
  name = "ubuntu-cloud-config"

  user_data    = <<-EOF
#cloud-config
package_update: true
package_upgrade: true
package_reboot_if_required: true
packages:
  - qemu-guest-agent
runcmd:
  - systemctl enable --now qemu-guest-agent
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  - chmod a+r /etc/apt/keyrings/docker.gpg
  - |
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
  - apt-get update
  - apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
  - systemctl enable --now docker
  - echo 'alias k=kubectl' >> /home/kalmyk/.bashrc
  - mkdir -p /home/kalmyk/.ssh && chmod 700 /home/kalmyk/.ssh
  - touch /home/kalmyk/.ssh/authorized_keys && chmod 600 /home/kalmyk/.ssh/authorized_keys
  - curl https://github.com/gregkonush.keys -o /home/kalmyk/.ssh/authorized_keys
groups:
  - docker
users:
  - name: kalmyk
    groups: [adm, cdrom, dip, plugdev, lxd, sudo, docker]
    lock_passwd: false
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    no_ssh_fingerprints: false
    ssh:
      emit_keys_to_console: false
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIZ/qbQDkfh+J3eZvJnpScECqBxKuovpS88mHaQlLt7z
EOF
  network_data = ""
}
