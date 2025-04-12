terraform {
  required_providers {
    harvester = {
      source  = "harvester/harvester"
      version = ">= 0.6.7"
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
      mac_address = "00:16:3E:3C:0D:00" // 192.168.1.150
      cpu         = 4
      memory      = "32Gi"
    }
    "kube-master-01" = {
      mac_address = "00:16:3E:3C:0D:01" // 192.168.1.151
      cpu         = 4
      memory      = "32Gi"
    }
    "kube-master-02" = {
      mac_address = "00:16:3E:3C:0D:02" // 192.168.1.152
      cpu         = 4
      memory      = "32Gi"
    }
    "kube-worker-00" = {
      mac_address = "00:16:3E:3C:0E:00" // 192.168.1.160
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-01" = {
      mac_address = "00:16:3E:3C:0E:01" // 192.168.1.161
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-02" = {
      mac_address = "00:16:3E:3C:0E:02" // 192.168.1.162
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-03" = {
      mac_address = "00:16:3E:3C:0E:03" // 192.168.1.163
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-04" = {
      mac_address = "00:16:3E:3C:0E:04" // 192.168.1.164
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-05" = {
      mac_address = "00:16:3E:3C:0E:05" // 192.168.1.165
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-06" = {
      mac_address = "00:16:3E:3C:0E:06" // 192.168.1.166
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-07" = {
      mac_address = "00:16:3E:3C:0E:07" // 192.168.1.167
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-08" = {
      mac_address = "00:16:3E:3C:0E:08" // 192.168.1.168
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-09" = {
      mac_address = "00:16:3E:3C:0E:09" // 192.168.1.169
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-10" = {
      mac_address = "00:16:3E:3C:0E:0A" // 192.168.1.170
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-11" = {
      mac_address = "00:16:3E:3C:0E:0B" // 192.168.1.171
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-12" = {
      mac_address = "00:16:3E:3C:0E:0C" // 192.168.1.172
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-13" = {
      mac_address = "00:16:3E:3C:0E:0D" // 192.168.1.173
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-14" = {
      mac_address = "00:16:3E:3C:0E:0E" // 192.168.1.174
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-15" = {
      mac_address = "00:16:3E:3C:0E:0F" // 192.168.1.175
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-16" = {
      mac_address = "00:16:3E:3C:0E:10" // 192.168.1.176
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-17" = {
      mac_address = "00:16:3E:3C:0E:11" // 192.168.1.177
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-18" = {
      mac_address = "00:16:3E:3C:0E:12" // 192.168.1.178
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-19" = {
      mac_address = "00:16:3E:3C:0E:13" // 192.168.1.179
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-20" = {
      mac_address = "00:16:3E:3C:0E:14" // 192.168.1.180
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-21" = {
      mac_address = "00:16:3E:3C:0E:15" // 192.168.1.181
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-22" = {
      mac_address = "00:16:3E:3C:0E:16" // 192.168.1.182
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-23" = {
      mac_address = "00:16:3E:3C:0E:17" // 192.168.1.183
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-24" = {
      mac_address = "00:16:3E:3C:0E:18" // 192.168.1.184
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-25" = {
      mac_address = "00:16:3E:3C:0E:19" // 192.168.1.185
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-26" = {
      mac_address = "00:16:3E:3C:0E:1A" // 192.168.1.186
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-27" = {
      mac_address = "00:16:3E:3C:0E:1B" // 192.168.1.187
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-28" = {
      mac_address = "00:16:3E:3C:0E:1C" // 192.168.1.188
      cpu         = 4
      memory      = "24Gi"
    }
    "kube-worker-29" = {
      mac_address = "00:16:3E:3C:0E:1D" // 192.168.1.189
      cpu         = 4
      memory      = "24Gi"
    }
  }

  docker_vm = {
    "docker-host" = {
      mac_address = "00:16:3E:3C:0F:00" // 192.168.1.190
      cpu         = 4
      memory      = "16Gi"
    }
  }
}

resource "harvester_image" "ubuntu-focal" {
  name               = "ubuntu-focal"
  display_name       = "Ubuntu 20 Focal LTS"
  source_type        = "download"
  namespace          = "harvester-public"
  url                = "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-arm64.img"
  storage_class_name = harvester_storageclass.single-node-longhorn.name

  lifecycle {
    prevent_destroy = true
  }
}

resource "harvester_image" "ubuntu-jammy" {
  name               = "ubuntu-jammy"
  display_name       = "Ubuntu 22 Jammy LTS"
  source_type        = "download"
  namespace          = "harvester-public"
  url                = "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-arm64.img"
  storage_class_name = harvester_storageclass.single-node-longhorn.name

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
    size        = "100Gi"
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

  ssh_keys = [
    harvester_ssh_key.public-key.id
  ]
}

resource "harvester_ssh_key" "public-key" {
  name      = "1password"
  namespace = "default"

  public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDVYPSSdt6tjSWRooRm7nUDS73CebsP92G6GjFa9X+zy"
}

# https://github.com/harvester/harvester/issues/4739 ~ Disable fstrim
resource "harvester_cloudinit_secret" "ubuntu-plain" {
  name = "ubuntu-plain"

  user_data    = <<-EOF
#cloud-config
ssh_authorized_keys:
  - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIZ/qbQDkfh+J3eZvJnpScECqBxKuovpS88mHaQlLt7z
  - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOE//lpGZI2015yMUjHwhWJjgarTLIsqQBIFXlAanPvS
  - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDVYPSSdt6tjSWRooRm7nUDS73CebsP92G6GjFa9X+zy
package_update: true
package_upgrade: true
package_reboot_if_required: true
bootcmd:
  - sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="/&discard=off /' /etc/default/grub
  - update-grub
packages:
  - qemu-guest-agent
  - curl
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
  # Install Tailscale
  - curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  - curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
  - apt-get update
  - apt-get install -y tailscale
  - systemctl enable --now tailscaled
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
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDVYPSSdt6tjSWRooRm7nUDS73CebsP92G6GjFa9X+zy
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
  - curl
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
  # Install Tailscale
  - curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  - curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
  - apt-get update
  - apt-get install -y tailscale
  - systemctl enable --now tailscaled
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
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDVYPSSdt6tjSWRooRm7nUDS73CebsP92G6GjFa9X+zy
EOF
  network_data = ""
}

resource "harvester_virtualmachine" "docker-host" {
  for_each = local.docker_vm
  name     = each.key
  cpu      = each.value.cpu
  memory   = each.value.memory

  efi          = true
  hostname     = each.key
  run_strategy = "Always"

  disk {
    name        = "root"
    type        = "disk"
    size        = "100Gi"
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
    user_data_secret_name    = harvester_cloudinit_secret.ubuntu-docker.name
    network_data_secret_name = harvester_cloudinit_secret.ubuntu-docker.name
  }

  ssh_keys = [
    harvester_ssh_key.public-key.id
  ]
}
