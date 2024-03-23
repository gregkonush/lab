terraform {
  required_providers {
    harvester = {
      source  = "harvester/harvester"
      version = ">= 0.6.4"
    }
  }
  backend "pg" {
    conn_str = "postgres://localhost:5433/altra?sslmode=disable"
  }
}

provider "harvester" {
  kubeconfig = "~/.kube/altra.yaml"
}

resource "harvester_image" "ubuntu" {
  name         = "ubuntu"
  display_name = "Ubuntu Server Image"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-arm64.img"
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
  secure_boot  = true
  hostname     = "rancher2"
  run_strategy = "RerunOnFailure"

  disk {
    name        = "root"
    type        = "disk"
    size        = "20Gi"
    bus         = "virtio"
    auto_delete = true
    boot_order  = 1
    image       = harvester_image.ubuntu.id
  }


  network_interface {
    name           = "bridge"
    model          = "virtio"
    type           = "bridge"
    network_name   = harvester_network.cluster_network.name
    wait_for_lease = true
  }
}


