terraform {
  required_providers {
    harvester = {
      source  = "harvester/harvester"
      version = "= 0.6.4"
    }
  }
  backend "pg" {
    conn_str = "postgres://altra:@nuc.lan:5432/altra?sslmode=disable"
  }
}

provider "harvester" {
  kubeconfig = "~/.kube/altra.yaml"
}

locals {
  vms = {
    "kube-master-00" = {
      mac_address = "00:16:3E:3C:0E:FC" // 192.168.1.150
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-master-01" = {
      mac_address = "00:16:3E:3C:0E:FD" // 192.168.1.151
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-master-02" = {
      mac_address = "00:16:3E:3C:0E:FE" // 192.168.1.152
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-00" = {
      mac_address = "00:16:3E:3C:0E:FF" // 192.168.1.160
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-01" = {
      mac_address = "00:16:3E:3C:0E:00" // 192.168.1.161
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-02" = {
      mac_address = "00:16:3E:3C:0E:01" // 192.168.1.162
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-03" = {
      mac_address = "00:16:3E:3C:0E:02" // 192.168.1.163
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-04" = {
      mac_address = "00:16:3E:3C:0E:03" // 192.168.1.164
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-05" = {
      mac_address = "00:16:3E:3C:0E:04" // 192.168.1.165
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-06" = {
      mac_address = "00:16:3E:3C:0E:05" // 192.168.1.166
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-07" = {
      mac_address = "00:16:3E:3C:0E:06" // 192.168.1.167
      cpu         = 10
      memory      = "8Gi"
    }
    "kube-worker-08" = {
      mac_address = "00:16:3E:3C:0E:07" // 192.168.1.168
      cpu         = 10
      memory      = "8Gi"
    }
  }
}

resource "harvester_image" "ubuntu-focal" {
  name         = "ubuntu-focal"
  display_name = "Ubuntu 20 Focal LTS"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-arm64.img"

  lifecycle {
    prevent_destroy = true
  }
}

resource "harvester_image" "ubuntu-jammy" {
  name         = "ubuntu-jammy"
  display_name = "Ubuntu 22 Jammy LTS"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-arm64.img"

  lifecycle {
    prevent_destroy = true
  }
}

data "harvester_clusternetwork" "mgmt" {
  name = "mgmt"
}

resource "harvester_storageclass" "single-node-longhorn" {
  name               = "single-node-longhorn"
  volume_provisioner = "driver.longhorn.io"
  is_default         = true

  parameters = {
    "migratable"          = "true"
    "numberOfReplicas"    = "1"
    "staleReplicaTimeout" = "30"
  }
  reclaim_policy         = "Delete"
  allow_volume_expansion = true
  volume_binding_mode    = "Immediate"
}

resource "harvester_network" "cluster_network" {
  cluster_network_name = data.harvester_clusternetwork.mgmt.name
  name                 = "cluster-network"
  vlan_id              = 1
}

resource "harvester_virtualmachine" "kube-cluster" {
  for_each = local.vms
  name     = each.key
  cpu      = each.value.cpu
  memory   = each.value.memory

  efi          = true
  hostname     = each.key
  run_strategy = "Always"

  disk {
    name        = "root"
    type        = "disk"
    size        = "200Gi"
    bus         = "virtio"
    boot_order  = 1
    image       = harvester_image.ubuntu-jammy.id
    auto_delete = true
  }

  network_interface {
    name           = "bridge"
    model          = "virtio"
    type           = "bridge"
    mac_address    = each.value.mac_address
    network_name   = harvester_network.cluster_network.name
    wait_for_lease = true
  }

  cloudinit {
    user_data_secret_name    = harvester_cloudinit_secret.ubuntu-plain.name
    network_data_secret_name = harvester_cloudinit_secret.ubuntu-plain.name
  }
}

# https://github.com/harvester/harvester/issues/4739 ~ Disable fstrim
resource "harvester_cloudinit_secret" "ubuntu-plain" {
  name = "ubuntu-plain"

  user_data    = <<-EOF
#cloud-config
package_update: true
package_upgrade: true
package_reboot_if_required: true
bootcmd:
  - sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="/&discard=off /' /etc/default/grub
  - update-grub
packages:
  - qemu-guest-agent
write-files:
  - path: /etc/sysctl.d/60-nvme-optimizations.conf
    content: |
      vm.max_map_count = 262144
      fs.file-max = 65536
      vm.swappiness = 10
  - path: /etc/udev/rules.d/60-scheduler-nvme.rules
    content: |
      # Set I/O scheduler to 'none' for NVMe devices
      ACTION=="add|change", KERNEL=="nvme[0-9]n[0-9]", ATTR{queue/scheduler}="none"
  - path: /etc/systemd/system/fstrim.timer.d/override.conf
    content: |
      [Timer]
      OnCalendar=
  - path: /etc/systemd/system/fstrim.service.d/override.conf
    content: |
      [Service]
      ExecStart=
runcmd:
  - systemctl enable --now qemu-guest-agent
  - systemctl mask fstrim.timer
  - systemctl stop fstrim.timer
  - systemctl mask fstrim.service
  - systemctl stop fstrim.service
  - sysctl -p /etc/sysctl.d/60-nvme-optimizations.conf
  - udevadm control --reload-rules
  - udevadm trigger
bootcmd:
  - systemctl daemon-reload
users:
  - name: kalmyk
    groups: [adm, cdrom, dip, plugdev, lxd, sudo]
    lock_passwd: false
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    no_ssh_fingerprints: false
    ssh:
      emit_keys_to_console: false
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIZ/qbQDkfh+J3eZvJnpScECqBxKuovpS88mHaQlLt7z
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOE//lpGZI2015yMUjHwhWJjgarTLIsqQBIFXlAanPvS
  - name: xueyingxia
    groups: [adm, cdrom, dip, plugdev, lxd, sudo]
    lock_passwd: false
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    no_ssh_fingerprints: false
    ssh:
      emit_keys_to_console: false
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILWfFMdjfvEs7lXmrGiE++QDNve9M+Lg/uoGBW8C/+kT
EOF
  network_data = ""
}

resource "harvester_cloudinit_secret" "ubuntu-docker" {
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
  - name: xueyingxia
    groups: [adm, cdrom, dip, plugdev, lxd, sudo, docker]
    lock_passwd: false
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    no_ssh_fingerprints: false
    ssh:
      emit_keys_to_console: false
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILWfFMdjfvEs7lXmrGiE++QDNve9M+Lg/uoGBW8C/+kT
EOF
  network_data = ""
}
